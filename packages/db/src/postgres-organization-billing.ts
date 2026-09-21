import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  CreditReservationSchema,
  OrganizationWalletBucketSchema,
  OrganizationWalletLedgerEntrySchema,
  OrganizationWalletSchema,
  UsageSettlementSchema,
  type CreditReservation,
  type OrganizationWallet,
  type OrganizationWalletBucket,
  type OrganizationWalletLedgerEntry,
  type UsageSettlement,
} from '@astra/contracts';
import {
  BillingError,
  type OrganizationBillingStore,
  type OrganizationGrantCreditsInput,
  type OrganizationReserveCreditsInput,
  type OrganizationRolloverSubscriptionCreditsInput,
  type SettleCreditsInput,
  addCredits,
  compareCredits,
  creditsFromUsd,
  formatCredits,
  formatUsd,
  parseCredits,
  parseUsd,
  subtractCredits,
  subtractUsd,
} from '@astra/billing';

function requireUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new BillingError(
      'IDEMPOTENCY_CONFLICT',
      `${field} must be a UUID for PostgreSQL billing`,
    );
  return value;
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapWallet(row: Record<string, unknown>): OrganizationWallet {
  return OrganizationWalletSchema.parse({
    walletId: String(row.id),
    organizationId: String(row.organization_id),
    availableCredits: String(row.available_credits),
    reservedCredits: String(row.reserved_credits),
    consumedCredits: String(row.consumed_credits),
    updatedAt: iso(row.updated_at),
  });
}

function mapBucket(row: Record<string, unknown>): OrganizationWalletBucket {
  return OrganizationWalletBucketSchema.parse({
    id: String(row.id),
    organizationId: String(row.organization_id),
    sourceType: String(row.source_type),
    originalCredits: String(row.original_credits),
    remainingCredits: String(row.available_credits),
    idempotencyKey: String(row.idempotency_key),
    referenceId: row.reference_id === null ? null : String(row.reference_id),
    planCycle: row.plan_cycle === null ? null : String(row.plan_cycle),
    expiresAt: row.expires_at === null ? null : iso(row.expires_at),
    createdAt: iso(row.created_at),
  });
}

function mapLedger(row: Record<string, unknown>): OrganizationWalletLedgerEntry {
  return OrganizationWalletLedgerEntrySchema.parse({
    id: String(row.id),
    organizationId: String(row.organization_id),
    actorUserId: String(row.actor_user_id),
    roomId: row.room_id === null ? null : String(row.room_id),
    taskId: row.task_key === null ? null : String(row.task_key),
    amountCredits: String(row.amount_credits),
    transactionType: String(row.transaction_type),
    idempotencyKey: row.idempotency_key === null ? null : String(row.idempotency_key),
    reason: String(row.reason),
    availableDeltaCredits: String(row.available_delta_credits),
    reservedDeltaCredits: String(row.reserved_delta_credits),
    consumedDeltaCredits: String(row.consumed_delta_credits),
    createdAt: iso(row.created_at),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  });
}

type BucketAllocation = { bucketId: string; amountCredits: string };

function allocationsFromRow(row: Record<string, unknown>): BucketAllocation[] {
  const value = row.bucket_allocations;
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      bucketId: String(item.bucketId ?? item.bucket_id),
      amountCredits: String(item.amountCredits ?? item.amount_credits),
    };
  });
}

function mapReservation(row: Record<string, unknown>): CreditReservation {
  const organizationId = String(row.organization_id);
  const actorUserId = String(row.actor_user_id);
  return CreditReservationSchema.parse({
    reservationId: String(row.id),
    userId: actorUserId,
    organizationId,
    actorUserId,
    roomId: row.room_id === null ? null : String(row.room_id),
    hostDeviceId: row.host_device_id === null ? null : String(row.host_device_id),
    taskId: String(row.task_key),
    ...(row.model_id === null ? {} : { modelId: String(row.model_id) }),
    amountCredits: String(row.amount_credits),
    status: String(row.status),
    idempotencyKey: String(row.idempotency_key),
    createdAt: iso(row.created_at),
    settledAt: row.settled_at === null ? null : iso(row.settled_at),
    bucketAllocations: allocationsFromRow(row),
  });
}

function mapSettlement(
  row: Record<string, unknown>,
  reservation: CreditReservation,
): UsageSettlement {
  return UsageSettlementSchema.parse({
    settlementId: String(row.id),
    reservationId: String(row.reservation_id),
    organizationId: reservation.organizationId,
    actorUserId: reservation.actorUserId ?? reservation.userId,
    roomId: reservation.roomId ?? null,
    hostDeviceId: reservation.hostDeviceId ?? null,
    providerActualCostUsd: String(row.provider_actual_cost_usd),
    customerBillableCostUsd: String(row.customer_billable_cost_usd),
    absorbedCostUsd: String(row.absorbed_cost_usd),
    reservedCredits: String(row.reserved_credits),
    settledCredits: String(row.settled_credits),
    releasedCredits: String(row.released_credits),
    idempotencyKey: String(row.idempotency_key),
    createdAt: iso(row.created_at),
  });
}

function bucketSource(input: OrganizationGrantCreditsInput): string {
  if (input.sourceType) return input.sourceType;
  if (input.transactionType === 'CREDIT_PURCHASE') return 'purchased_topup';
  if (input.transactionType === 'PROMO_CREDIT') return 'promotional';
  if (input.transactionType === 'REFUND') return 'refund_adjustment';
  if (input.transactionType === 'ADJUSTMENT') return 'admin_adjustment';
  return 'subscription_monthly';
}

async function ensureWallet(
  client: PoolClient,
  organizationId: string,
): Promise<OrganizationWallet> {
  const existing = await client.query(
    'SELECT * FROM organization_wallets WHERE organization_id = $1 FOR UPDATE',
    [organizationId],
  );
  if (existing.rows[0]) return mapWallet(existing.rows[0] as Record<string, unknown>);
  const id = randomUUID();
  const inserted = await client.query(
    `INSERT INTO organization_wallets
       (id, organization_id, available_credits, reserved_credits, consumed_credits)
     VALUES ($1, $2, 0, 0, 0)
     RETURNING *`,
    [id, organizationId],
  );
  return mapWallet(inserted.rows[0] as Record<string, unknown>);
}

async function expireBuckets(
  client: PoolClient,
  organizationId: string,
  actorUserId: string,
  now: string,
): Promise<void> {
  const expired = await client.query(
    `SELECT * FROM organization_wallet_buckets
      WHERE organization_id = $1 AND available_credits > 0
        AND expires_at IS NOT NULL AND expires_at <= $2
      FOR UPDATE`,
    [organizationId, now],
  );
  for (const row of expired.rows as Array<Record<string, unknown>>) {
    const amount = formatCredits(parseCredits(String(row.available_credits)));
    await client.query(
      `UPDATE organization_wallet_buckets
          SET available_credits = 0
        WHERE id = $1 AND organization_id = $2`,
      [String(row.id), organizationId],
    );
    await client.query(
      `INSERT INTO organization_credit_ledger_entries
        (id, organization_id, actor_user_id, task_key, amount_credits, transaction_type,
         idempotency_key, reason, available_delta_credits, metadata, created_at)
       VALUES ($1, $2, $3, NULL, $4, 'ADJUSTMENT', $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        organizationId,
        actorUserId,
        amount,
        `organization-bucket-expiry:${String(row.id)}`,
        'Expire unused organization credit bucket',
        `-${amount}`,
        { bucketId: String(row.id), reason: 'bucket_expired' },
        now,
      ],
    );
    await client.query(
      `UPDATE organization_wallets
          SET available_credits = available_credits - $2, updated_at = $3
        WHERE organization_id = $1`,
      [organizationId, amount, now],
    );
  }
}

function allocateBucketRows(
  rows: Array<Record<string, unknown>>,
  amount: string,
): Array<{ bucketId: string; amount: string }> | null {
  let remaining = parseCredits(amount);
  const allocations: Array<{ bucketId: string; amount: string }> = [];
  for (const row of rows) {
    if (remaining <= 0n) break;
    const available = parseCredits(String(row.available_credits));
    if (available <= 0n) continue;
    const allocated = available < remaining ? available : remaining;
    allocations.push({ bucketId: String(row.id), amount: formatCredits(allocated) });
    remaining -= allocated;
  }
  return remaining > 0n ? null : allocations;
}

export class PostgresOrganizationBillingStore implements OrganizationBillingStore {
  constructor(private readonly pool: Pool) {}

  async getWallet(organizationId: string): Promise<OrganizationWallet> {
    const id = requireUuid(organizationId, 'organizationId');
    const result = await this.pool.query(
      'SELECT * FROM organization_wallets WHERE organization_id = $1',
      [id],
    );
    if (result.rows[0]) return mapWallet(result.rows[0] as Record<string, unknown>);
    return OrganizationWalletSchema.parse({
      walletId: randomUUID(),
      organizationId: id,
      availableCredits: '0',
      reservedCredits: '0',
      consumedCredits: '0',
      updatedAt: new Date().toISOString(),
    });
  }

  async getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM organization_credit_reservations WHERE id = $1',
      [requireUuid(reservationId, 'reservationId')],
    );
    return result.rows[0] ? mapReservation(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async countActiveReservations(organizationId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count
         FROM organization_credit_reservations
        WHERE organization_id = $1 AND status = 'RESERVED'`,
      [requireUuid(organizationId, 'organizationId')],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async grantCredits(input: OrganizationGrantCreditsInput): Promise<OrganizationWalletLedgerEntry> {
    const organizationId = requireUuid(input.organizationId, 'organizationId');
    const actorUserId = requireUuid(input.actorUserId, 'actorUserId');
    const amount = formatCredits(parseCredits(input.amountCredits));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT * FROM organization_credit_ledger_entries WHERE organization_id = $1 AND idempotency_key = $2',
        [organizationId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        const existing = mapLedger(duplicate.rows[0] as Record<string, unknown>);
        if (
          existing.actorUserId !== actorUserId ||
          existing.amountCredits !== amount ||
          existing.transactionType !== input.transactionType
        )
          throw new BillingError(
            'IDEMPOTENCY_CONFLICT',
            'Organization grant key was reused with different values',
          );
        await client.query('COMMIT');
        return existing;
      }
      if (amount === '0')
        throw new BillingError('IDEMPOTENCY_CONFLICT', 'Credit grant must be positive');
      await ensureWallet(client, organizationId);
      const now = new Date().toISOString();
      const entryResult = await client.query(
        `INSERT INTO organization_credit_ledger_entries
          (id, organization_id, actor_user_id, room_id, task_key, amount_credits,
           transaction_type, idempotency_key, reason, available_delta_credits,
           reserved_delta_credits, consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $6, 0, 0, $10, $11)
         RETURNING *`,
        [
          randomUUID(),
          organizationId,
          actorUserId,
          input.roomId ?? null,
          input.taskId ?? null,
          amount,
          input.transactionType,
          input.idempotencyKey,
          input.reason,
          input.metadata ?? {},
          now,
        ],
      );
      await client.query(
        `UPDATE organization_wallets
            SET available_credits = available_credits + $2, updated_at = $3
          WHERE organization_id = $1`,
        [organizationId, amount, now],
      );
      const metadata = input.metadata ?? {};
      await client.query(
        `INSERT INTO organization_wallet_buckets
          (id, organization_id, source_type, original_credits, available_credits,
           reserved_credits, expires_at, created_at, idempotency_key, reference_id, plan_cycle)
         VALUES ($1, $2, $3, $4, $4, 0, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          organizationId,
          bucketSource(input),
          amount,
          input.expiresAt ?? (typeof metadata.expiresAt === 'string' ? metadata.expiresAt : null),
          now,
          input.idempotencyKey,
          input.referenceId ??
            (typeof metadata.referenceId === 'string' ? metadata.referenceId : null),
          input.planCycle ?? (typeof metadata.planCycle === 'string' ? metadata.planCycle : null),
        ],
      );
      await client.query('COMMIT');
      return mapLedger(entryResult.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listBuckets(organizationId: string): Promise<OrganizationWalletBucket[]> {
    const result = await this.pool.query(
      'SELECT * FROM organization_wallet_buckets WHERE organization_id = $1 ORDER BY expires_at NULLS LAST, created_at ASC',
      [requireUuid(organizationId, 'organizationId')],
    );
    return result.rows.map((row) => mapBucket(row as Record<string, unknown>));
  }

  async reserveCredits(input: OrganizationReserveCreditsInput): Promise<CreditReservation> {
    const organizationId = requireUuid(input.organizationId, 'organizationId');
    const actorUserId = requireUuid(input.actorUserId, 'actorUserId');
    const roomId = input.roomId ? requireUuid(input.roomId, 'roomId') : null;
    const hostDeviceId = input.hostDeviceId
      ? requireUuid(input.hostDeviceId, 'hostDeviceId')
      : null;
    const amount = formatCredits(parseCredits(input.amountCredits));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT * FROM organization_credit_reservations WHERE organization_id = $1 AND idempotency_key = $2',
        [organizationId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        const existing = mapReservation(duplicate.rows[0] as Record<string, unknown>);
        if (
          existing.actorUserId !== actorUserId ||
          existing.roomId !== roomId ||
          existing.taskId !== input.taskId ||
          existing.modelId !== input.modelId ||
          existing.amountCredits !== amount
        )
          throw new BillingError(
            'IDEMPOTENCY_CONFLICT',
            'Organization reservation key was reused with different values',
          );
        await client.query('COMMIT');
        return existing;
      }
      await ensureWallet(client, organizationId);
      const now = new Date().toISOString();
      await expireBuckets(client, organizationId, actorUserId, now);
      const currentWallet = mapWallet(
        (
          await client.query(
            'SELECT * FROM organization_wallets WHERE organization_id = $1 FOR UPDATE',
            [organizationId],
          )
        ).rows[0] as Record<string, unknown>,
      );
      if (compareCredits(currentWallet.availableCredits, amount) < 0)
        throw new BillingError(
          'INSUFFICIENT_CREDITS',
          'Insufficient organization credits for reservation',
        );
      const bucketRows = await client.query(
        `SELECT * FROM organization_wallet_buckets
          WHERE organization_id = $1 AND available_credits > 0
            AND (expires_at IS NULL OR expires_at > $2)
          ORDER BY expires_at NULLS LAST, created_at ASC
          FOR UPDATE`,
        [organizationId, now],
      );
      const allocations = allocateBucketRows(
        bucketRows.rows as Array<Record<string, unknown>>,
        amount,
      );
      if (bucketRows.rowCount && !allocations)
        throw new BillingError(
          'INSUFFICIENT_CREDITS',
          'Insufficient unexpired organization credits',
        );
      const reservationResult = await client.query(
        `INSERT INTO organization_credit_reservations
          (id, organization_id, actor_user_id, room_id, host_device_id, task_key,
           model_id, amount_credits, status, idempotency_key, bucket_allocations, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RESERVED', $9, $10::jsonb, $11)
         RETURNING *`,
        [
          randomUUID(),
          organizationId,
          actorUserId,
          roomId,
          hostDeviceId,
          input.taskId,
          input.modelId ?? null,
          amount,
          input.idempotencyKey,
          JSON.stringify(
            (allocations ?? []).map((allocation) => ({
              bucketId: allocation.bucketId,
              amountCredits: allocation.amount,
            })),
          ),
          now,
        ],
      );
      const reservation = mapReservation(reservationResult.rows[0] as Record<string, unknown>);
      await client.query(
        `UPDATE organization_wallets
            SET available_credits = available_credits - $2,
                reserved_credits = reserved_credits + $2,
                updated_at = $3
          WHERE organization_id = $1`,
        [organizationId, amount, now],
      );
      for (const allocation of allocations ?? [])
        await client.query(
          `UPDATE organization_wallet_buckets
              SET available_credits = available_credits - $2,
                  reserved_credits = reserved_credits + $2
            WHERE id = $1 AND organization_id = $3`,
          [allocation.bucketId, allocation.amount, organizationId],
        );
      await client.query(
        `INSERT INTO organization_credit_ledger_entries
          (id, organization_id, actor_user_id, room_id, task_key, amount_credits,
           transaction_type, idempotency_key, reason, available_delta_credits,
           reserved_delta_credits, consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'USAGE_RESERVE', $7, $8, -$6, $6, 0, $9, $10)`,
        [
          randomUUID(),
          organizationId,
          actorUserId,
          roomId,
          input.taskId,
          amount,
          input.idempotencyKey,
          'Organization task usage reservation',
          { reservationId: reservation.reservationId, hostDeviceId },
          now,
        ],
      );
      await client.query('COMMIT');
      return reservation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async settleCredits(input: SettleCreditsInput): Promise<UsageSettlement> {
    const reservationId = requireUuid(input.reservationId, 'reservationId');
    const providerActualCostUsd = formatUsd(parseUsd(input.providerActualCostUsd));
    const customerBillableCostUsd = formatUsd(parseUsd(input.customerBillableCostUsd));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicateResult = await client.query(
        `SELECT settlement.*, reservation.organization_id, reservation.actor_user_id,
                reservation.room_id, reservation.host_device_id, reservation.task_key,
                reservation.model_id, reservation.amount_credits AS reservation_amount,
                reservation.status AS reservation_status, reservation.idempotency_key AS reservation_key,
                reservation.created_at AS reservation_created_at, reservation.settled_at AS reservation_settled_at,
                reservation.bucket_allocations
           FROM organization_usage_settlements settlement
           JOIN organization_credit_reservations reservation
             ON reservation.id = settlement.reservation_id
          WHERE settlement.organization_id = reservation.organization_id
            AND settlement.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (duplicateResult.rows[0]) {
        const duplicateRow = duplicateResult.rows[0] as Record<string, unknown>;
        const duplicateReservation = mapReservation({
          id: duplicateRow.reservation_id,
          organization_id: duplicateRow.organization_id,
          actor_user_id: duplicateRow.actor_user_id,
          room_id: duplicateRow.room_id,
          host_device_id: duplicateRow.host_device_id,
          task_key: duplicateRow.task_key,
          model_id: duplicateRow.model_id,
          amount_credits: duplicateRow.reservation_amount,
          status: duplicateRow.reservation_status,
          idempotency_key: duplicateRow.reservation_key,
          created_at: duplicateRow.reservation_created_at,
          settled_at: duplicateRow.reservation_settled_at,
          bucket_allocations: duplicateRow.bucket_allocations,
        });
        const existing = mapSettlement(duplicateRow, duplicateReservation);
        if (
          existing.reservationId !== reservationId ||
          existing.providerActualCostUsd !== providerActualCostUsd ||
          existing.customerBillableCostUsd !== customerBillableCostUsd
        )
          throw new BillingError(
            'IDEMPOTENCY_CONFLICT',
            'Organization settlement key was reused with different values',
          );
        await client.query('COMMIT');
        return existing;
      }
      const reservationResult = await client.query(
        'SELECT * FROM organization_credit_reservations WHERE id = $1 FOR UPDATE',
        [reservationId],
      );
      const reservationRow = reservationResult.rows[0] as Record<string, unknown> | undefined;
      if (!reservationRow)
        throw new BillingError('RESERVATION_NOT_FOUND', 'Organization reservation not found');
      const reservation = mapReservation(reservationRow);
      if (reservation.status !== 'RESERVED')
        throw new BillingError(
          'RESERVATION_ALREADY_SETTLED',
          'Organization reservation is already closed',
        );
      const settledCredits = creditsFromUsd(customerBillableCostUsd);
      if (compareCredits(settledCredits, reservation.amountCredits) > 0)
        throw new BillingError(
          'RESERVATION_EXCEEDED',
          'Actual customer cost exceeded reserved credits',
        );
      const releasedCredits = subtractCredits(reservation.amountCredits, settledCredits);
      const absorbedCostUsd = subtractUsd(providerActualCostUsd, customerBillableCostUsd);
      const now = new Date().toISOString();
      const settlementResult = await client.query(
        `INSERT INTO organization_usage_settlements
          (id, organization_id, reservation_id, provider_actual_cost_usd,
           customer_billable_cost_usd, absorbed_cost_usd, reserved_credits,
           settled_credits, released_credits, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          randomUUID(),
          reservation.organizationId,
          reservation.reservationId,
          providerActualCostUsd,
          customerBillableCostUsd,
          absorbedCostUsd,
          reservation.amountCredits,
          settledCredits,
          releasedCredits,
          input.idempotencyKey,
          now,
        ],
      );
      const walletResult = await client.query(
        'SELECT * FROM organization_wallets WHERE organization_id = $1 FOR UPDATE',
        [requireUuid(reservation.organizationId ?? '', 'organizationId')],
      );
      const wallet = mapWallet(walletResult.rows[0] as Record<string, unknown>);
      const nextWallet: OrganizationWallet = OrganizationWalletSchema.parse({
        ...wallet,
        availableCredits: addCredits(wallet.availableCredits, releasedCredits),
        reservedCredits: subtractCredits(wallet.reservedCredits, reservation.amountCredits),
        consumedCredits: addCredits(wallet.consumedCredits, settledCredits),
        updatedAt: now,
      });
      await client.query(
        `UPDATE organization_wallets
            SET available_credits = $2, reserved_credits = $3,
                consumed_credits = $4, updated_at = $5
          WHERE organization_id = $1`,
        [
          reservation.organizationId,
          nextWallet.availableCredits,
          nextWallet.reservedCredits,
          nextWallet.consumedCredits,
          now,
        ],
      );
      for (const allocation of reservation.bucketAllocations) {
        const reservedAmount = parseCredits(allocation.amountCredits);
        const settledAmount =
          parseCredits(settledCredits) < reservedAmount
            ? parseCredits(settledCredits)
            : reservedAmount;
        if (settledAmount > 0n)
          await client.query(
            `UPDATE organization_wallet_buckets
                SET reserved_credits = reserved_credits - $2
              WHERE id = $1 AND organization_id = $3`,
            [allocation.bucketId, formatCredits(settledAmount), reservation.organizationId],
          );
      }
      let releaseRemaining = parseCredits(releasedCredits);
      for (const allocation of [...reservation.bucketAllocations].reverse()) {
        if (releaseRemaining <= 0n) break;
        const allocationAmount = parseCredits(allocation.amountCredits);
        const released = allocationAmount < releaseRemaining ? allocationAmount : releaseRemaining;
        await client.query(
          `UPDATE organization_wallet_buckets
              SET available_credits = available_credits + $2,
                  reserved_credits = reserved_credits - $2
            WHERE id = $1 AND organization_id = $3`,
          [allocation.bucketId, formatCredits(released), reservation.organizationId],
        );
        releaseRemaining -= released;
      }
      const actorUserId = reservation.actorUserId ?? reservation.userId;
      await client.query(
        `INSERT INTO organization_credit_ledger_entries
          (id, organization_id, actor_user_id, room_id, task_key, amount_credits,
           transaction_type, idempotency_key, reason, reserved_delta_credits,
           consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'USAGE_SETTLEMENT', $7, $8, -$6, $6, $9, $10)`,
        [
          randomUUID(),
          reservation.organizationId,
          actorUserId,
          reservation.roomId ?? null,
          reservation.taskId,
          settledCredits,
          `${input.idempotencyKey}:settlement`,
          'Actual organization task usage settlement',
          { reservationId, providerActualCostUsd, customerBillableCostUsd, absorbedCostUsd },
          now,
        ],
      );
      if (releasedCredits !== '0')
        await client.query(
          `INSERT INTO organization_credit_ledger_entries
            (id, organization_id, actor_user_id, room_id, task_key, amount_credits,
             transaction_type, idempotency_key, reason, available_delta_credits,
             reserved_delta_credits, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'RESERVE_RELEASE', $7, $8, $6, -$6, $9, $10)`,
          [
            randomUUID(),
            reservation.organizationId,
            actorUserId,
            reservation.roomId ?? null,
            reservation.taskId,
            releasedCredits,
            `${input.idempotencyKey}:release`,
            'Release unused organization task reservation',
            { reservationId },
            now,
          ],
        );
      await client.query(
        `UPDATE organization_credit_reservations
            SET status = 'SETTLED', settled_at = $2
          WHERE id = $1`,
        [reservationId, now],
      );
      await client.query('COMMIT');
      return mapSettlement(settlementResult.rows[0] as Record<string, unknown>, {
        ...reservation,
        status: 'SETTLED',
        settledAt: now,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rolloverSubscriptionCredits(
    input: OrganizationRolloverSubscriptionCreditsInput,
  ): Promise<string> {
    const organizationId = requireUuid(input.organizationId, 'organizationId');
    const actorUserId = requireUuid(input.actorUserId, 'actorUserId');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT available_credits
           FROM organization_wallet_buckets
          WHERE organization_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [organizationId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const amount = formatCredits(parseCredits(String(existing.rows[0].available_credits)));
        await client.query('COMMIT');
        return amount;
      }
      const limit = parseCredits(input.monthlyAllocation);
      const candidates = await client.query(
        `SELECT * FROM organization_wallet_buckets
          WHERE organization_id = $1
            AND source_type IN ('subscription_monthly', 'SUBSCRIPTION_GRANT')
            AND plan_cycle IS NOT NULL
            AND plan_cycle <> $2
            AND available_credits > 0
            AND (expires_at IS NULL OR expires_at >= $2::timestamptz)
          ORDER BY plan_cycle DESC, created_at DESC
          FOR UPDATE`,
        [organizationId, input.periodStart],
      );
      const source = candidates.rows[0] as Record<string, unknown> | undefined;
      if (!source || limit <= 0n) {
        await client.query('COMMIT');
        return '0';
      }
      const sourceRemaining = parseCredits(String(source.available_credits));
      const amount = formatCredits(sourceRemaining < limit ? sourceRemaining : limit);
      const now = new Date().toISOString();
      await client.query(
        `UPDATE organization_wallet_buckets
            SET available_credits = available_credits - $2
          WHERE id = $1 AND organization_id = $3`,
        [String(source.id), amount, organizationId],
      );
      const targetId = randomUUID();
      await client.query(
        `INSERT INTO organization_wallet_buckets
          (id, organization_id, source_type, original_credits, available_credits,
           reserved_credits, expires_at, created_at, idempotency_key, reference_id, plan_cycle)
         VALUES ($1, $2, 'subscription_monthly', $3, $3, 0, $4, $5, $6, $7, $8)`,
        [
          targetId,
          organizationId,
          amount,
          input.newExpiresAt ?? null,
          now,
          input.idempotencyKey,
          input.referenceId ?? null,
          input.periodStart,
        ],
      );
      for (const [suffix, delta, reason, metadata] of [
        [
          'source',
          `-${amount}`,
          'Move unused organization subscription credits into rollover bucket',
          { sourceBucketId: String(source.id), rollover: true },
        ],
        [
          'target',
          amount,
          'Create organization subscription rollover bucket',
          { bucketId: targetId, rollover: true },
        ],
      ] as const) {
        await client.query(
          `INSERT INTO organization_credit_ledger_entries
            (id, organization_id, actor_user_id, task_key, amount_credits,
             transaction_type, idempotency_key, reason, available_delta_credits,
             metadata, created_at)
           VALUES ($1, $2, $3, NULL, $4, 'ADJUSTMENT', $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            organizationId,
            actorUserId,
            amount,
            `${input.idempotencyKey}:${suffix}`,
            reason,
            delta,
            metadata,
            now,
          ],
        );
      }
      await client.query('COMMIT');
      return amount;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listLedger(organizationId: string): Promise<OrganizationWalletLedgerEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM organization_credit_ledger_entries
        WHERE organization_id = $1 ORDER BY created_at ASC, id ASC`,
      [requireUuid(organizationId, 'organizationId')],
    );
    return result.rows.map((row) => mapLedger(row as Record<string, unknown>));
  }
}
