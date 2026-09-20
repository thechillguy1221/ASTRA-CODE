import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CreditReservationSchema,
  UsageSettlementSchema,
  WalletLedgerEntrySchema,
  WalletSchema,
  type CreditReservation,
  type UsageSettlement,
  type Wallet,
  type WalletLedgerEntry,
  WalletBucketSchema,
  type WalletBucket,
} from '@lyntar/contracts';
import {
  BillingError,
  type AdjustCreditsInput,
  type BillingStore,
  type GrantCreditsInput,
  type ReserveCreditsInput,
  type SettleCreditsInput,
  type RolloverSubscriptionCreditsInput,
  addCredits,
  compareCredits,
  creditsFromUsd,
  formatCredits,
  formatUsd,
  parseCredits,
  parseUsd,
  subtractCredits,
  subtractUsd,
} from '@lyntar/billing';

function mapWallet(row: Record<string, unknown>): Wallet {
  return WalletSchema.parse({
    walletId: row.id,
    userId: row.user_id,
    availableCredits: String(row.available_credits),
    reservedCredits: String(row.reserved_credits),
    consumedCredits: String(row.consumed_credits),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapReservation(row: Record<string, unknown>): CreditReservation {
  return CreditReservationSchema.parse({
    reservationId: row.id,
    userId: row.user_id,
    taskId: row.task_key ?? row.task_id,
    ...(row.model_id ? { modelId: String(row.model_id) } : {}),
    amountCredits: String(row.amount_credits),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(String(row.created_at)).toISOString(),
    settledAt: row.settled_at ? new Date(String(row.settled_at)).toISOString() : null,
    bucketAllocations: Array.isArray(row.bucket_allocations)
      ? row.bucket_allocations.map((allocation) => ({
          bucketId: String((allocation as Record<string, unknown>).bucketId),
          amountCredits: String((allocation as Record<string, unknown>).amountCredits),
        }))
      : [],
  });
}

function mapBucket(row: Record<string, unknown>): WalletBucket {
  const rawSource = String(row.source_type);
  const sourceType =
    rawSource === 'SUBSCRIPTION_GRANT'
      ? 'subscription_monthly'
      : rawSource === 'CREDIT_PURCHASE'
        ? 'purchased_topup'
        : rawSource === 'PROMO_CREDIT'
          ? 'promotional'
          : rawSource === 'ADJUSTMENT'
            ? 'admin_adjustment'
            : rawSource;
  return WalletBucketSchema.parse({
    id: row.id,
    userId: row.user_id,
    sourceType,
    originalCredits: String(row.original_credits),
    remainingCredits: String(row.available_credits),
    idempotencyKey: String(row.idempotency_key ?? row.id),
    referenceId: row.reference_id ? String(row.reference_id) : null,
    planCycle: row.plan_cycle ? String(row.plan_cycle) : null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
}

function mapLedger(row: Record<string, unknown>): WalletLedgerEntry {
  return WalletLedgerEntrySchema.parse({
    id: row.id,
    userId: row.user_id,
    taskId: row.task_key ?? row.task_id ?? null,
    amountCredits: String(row.amount_credits),
    transactionType: row.transaction_type,
    idempotencyKey: row.idempotency_key,
    reason: row.reason,
    availableDeltaCredits: String(row.available_delta_credits),
    reservedDeltaCredits: String(row.reserved_delta_credits),
    consumedDeltaCredits: String(row.consumed_delta_credits),
    createdAt: new Date(String(row.created_at)).toISOString(),
    metadata: row.metadata ?? {},
  });
}

function mapSettlement(row: Record<string, unknown>): UsageSettlement {
  return UsageSettlementSchema.parse({
    settlementId: row.id,
    reservationId: row.reservation_id,
    providerActualCostUsd: String(row.provider_actual_cost_usd),
    customerBillableCostUsd: String(row.customer_billable_cost_usd),
    absorbedCostUsd: String(row.absorbed_cost_usd),
    reservedCredits: String(row.reserved_credits),
    settledCredits: String(row.settled_credits),
    releasedCredits: String(row.released_credits),
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
}

function requireUuid(value: string, label: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error(`${label} must be a UUID for PostgreSQL billing`);
  return value;
}

function taskUuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function bucketSourceType(input: GrantCreditsInput): string {
  if (input.sourceType) return input.sourceType;
  if (input.transactionType === 'CREDIT_PURCHASE') return 'purchased_topup';
  if (input.transactionType === 'PROMO_CREDIT') return 'promotional';
  if (input.transactionType === 'REFUND') return 'refund_adjustment';
  if (input.transactionType === 'ADJUSTMENT') return 'admin_adjustment';
  return 'subscription_monthly';
}

function allocateBucketRows(
  rows: Array<Record<string, unknown>>,
  amount: string,
): Array<{ bucketId: string; amountCredits: string }> | null {
  let remaining = parseCredits(amount);
  const allocations: Array<{ bucketId: string; amountCredits: string }> = [];
  for (const row of rows) {
    if (remaining <= 0n) break;
    const available = parseCredits(String(row.available_credits));
    if (available <= 0n) continue;
    const allocated = available < remaining ? available : remaining;
    allocations.push({ bucketId: String(row.id), amountCredits: formatCredits(allocated) });
    remaining -= allocated;
  }
  return remaining > 0n ? null : allocations;
}

async function ensureWallet(client: PoolClient, userId: string): Promise<Record<string, unknown>> {
  await client.query(
    'INSERT INTO wallets (id, user_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
    [randomUUID(), userId],
  );
  const result = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [
    userId,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('Wallet row was not created');
  return row;
}

async function expireAvailableBuckets(
  client: PoolClient,
  wallet: Wallet,
  now: string,
): Promise<Wallet> {
  const expired = await client.query(
    `SELECT id, available_credits
       FROM wallet_buckets
      WHERE wallet_id = $1
        AND available_credits > 0
        AND expires_at IS NOT NULL
        AND expires_at <= $2
      FOR UPDATE`,
    [wallet.walletId, now],
  );
  if (expired.rowCount === 0) return wallet;

  let next = wallet;
  for (const row of expired.rows as Array<Record<string, unknown>>) {
    const amount = formatCredits(parseCredits(String(row.available_credits)));
    if (amount === '0') continue;
    next = WalletSchema.parse({
      ...next,
      availableCredits: subtractCredits(next.availableCredits, amount),
      updatedAt: now,
    });
    await client.query(
      `UPDATE wallet_buckets
          SET available_credits = 0
        WHERE id = $1 AND wallet_id = $2`,
      [String(row.id), wallet.walletId],
    );
    await client.query(
      `INSERT INTO credit_ledger_entries
         (id, user_id, task_id, task_key, amount_credits, transaction_type,
          idempotency_key, reason, available_delta_credits, reserved_delta_credits,
          consumed_delta_credits, metadata, created_at)
       VALUES ($1, $2, NULL, NULL, $3, 'ADJUSTMENT', $4, $5, -$3, 0, 0, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        wallet.userId,
        amount,
        `bucket-expiry:${String(row.id)}`,
        'Expire unused credit bucket',
        { bucketId: String(row.id), reason: 'bucket_expired' },
        now,
      ],
    );
  }
  if (next.availableCredits !== wallet.availableCredits)
    await client.query('UPDATE wallets SET available_credits = $2, updated_at = $3 WHERE id = $1', [
      wallet.walletId,
      next.availableCredits,
      now,
    ]);
  return next;
}

export class PostgresBillingStore implements BillingStore {
  constructor(private readonly pool: Pool) {}

  async getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    const result = await this.pool.query('SELECT * FROM credit_reservations WHERE id = $1', [
      requireUuid(reservationId, 'reservationId'),
    ]);
    return result.rows[0] ? mapReservation(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async countActiveReservations(userId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count
         FROM credit_reservations
        WHERE user_id = $1 AND status = 'RESERVED'`,
      [requireUuid(userId, 'userId')],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getWallet(userId: string): Promise<Wallet> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await ensureWallet(client, requireUuid(userId, 'userId'));
      const wallet = await expireAvailableBuckets(client, mapWallet(row), new Date().toISOString());
      await client.query('COMMIT');
      return wallet;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listBuckets(userId: string): Promise<WalletBucket[]> {
    const result = await this.pool.query(
      `SELECT * FROM wallet_buckets
        WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = $1)
        ORDER BY expires_at NULLS LAST, created_at ASC`,
      [requireUuid(userId, 'userId')],
    );
    return result.rows.map((row) => mapBucket(row as Record<string, unknown>));
  }

  async grantCredits(input: GrantCreditsInput): Promise<WalletLedgerEntry> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT * FROM credit_ledger_entries WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        const existing = mapLedger(duplicate.rows[0] as Record<string, unknown>);
        if (
          existing.userId !== input.userId ||
          existing.amountCredits !== formatCredits(parseCredits(input.amountCredits)) ||
          existing.transactionType !== input.transactionType
        )
          throw new BillingError(
            'IDEMPOTENCY_CONFLICT',
            'Credit grant key was reused with different values',
          );
        await client.query('COMMIT');
        return existing;
      }
      const userId = requireUuid(input.userId, 'userId');
      const amount = formatCredits(parseCredits(input.amountCredits));
      if (amount === '0')
        throw new BillingError('IDEMPOTENCY_CONFLICT', 'Credit grant must be positive');
      const wallet = mapWallet(await ensureWallet(client, userId));
      const now = new Date().toISOString();
      const result = await client.query(
        `INSERT INTO credit_ledger_entries (id, user_id, task_id, task_key, amount_credits, transaction_type, idempotency_key, reason, available_delta_credits, reserved_delta_credits, consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, 0, 0, $9, $10) RETURNING *`,
        [
          randomUUID(),
          userId,
          taskUuidOrNull(input.taskId),
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
        'UPDATE wallets SET available_credits = available_credits + $2, updated_at = $3 WHERE user_id = $1',
        [userId, amount, now],
      );
      const metadata = input.metadata ?? {};
      await client.query(
        `INSERT INTO wallet_buckets
           (id, wallet_id, source_type, original_credits, available_credits, reserved_credits,
            expires_at, created_at, idempotency_key, reference_id, plan_cycle)
         VALUES ($1, $2, $3, $4, $4, 0, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          wallet.walletId,
          bucketSourceType(input),
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
      void wallet;
      return mapLedger(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reserveCredits(input: ReserveCreditsInput): Promise<CreditReservation> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT * FROM credit_reservations WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        const existing = mapReservation(duplicate.rows[0] as Record<string, unknown>);
        if (
          existing.userId !== input.userId ||
          existing.taskId !== input.taskId ||
          existing.modelId !== input.modelId ||
          existing.amountCredits !== formatCredits(parseCredits(input.amountCredits))
        )
          throw new BillingError(
            'IDEMPOTENCY_CONFLICT',
            'Reservation key was reused with different values',
          );
        await client.query('COMMIT');
        return existing;
      }
      const userId = requireUuid(input.userId, 'userId');
      const taskId = taskUuidOrNull(input.taskId);
      const amount = formatCredits(parseCredits(input.amountCredits));
      const wallet = await expireAvailableBuckets(
        client,
        mapWallet(await ensureWallet(client, userId)),
        new Date().toISOString(),
      );
      if (compareCredits(wallet.availableCredits, amount) < 0)
        throw new BillingError('INSUFFICIENT_CREDITS', 'Insufficient credits for task reservation');
      const bucketRows = await client.query(
        `SELECT * FROM wallet_buckets
          WHERE wallet_id = $1
            AND available_credits > 0
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY expires_at NULLS LAST, created_at ASC
          FOR UPDATE`,
        [wallet.walletId],
      );
      const bucketAllocations = allocateBucketRows(
        bucketRows.rows as Array<Record<string, unknown>>,
        amount,
      );
      const bucketCount = await client.query(
        'SELECT COUNT(*)::int AS count FROM wallet_buckets WHERE wallet_id = $1',
        [wallet.walletId],
      );
      if (Number(bucketCount.rows[0]?.count ?? 0) > 0 && !bucketAllocations)
        throw new BillingError(
          'INSUFFICIENT_CREDITS',
          'Insufficient unexpired credits for task reservation',
        );
      const now = new Date().toISOString();
      const reservationResult = await client.query(
        `INSERT INTO credit_reservations (id, user_id, task_id, task_key, model_id, amount_credits, status, idempotency_key, created_at, bucket_allocations)
         VALUES ($1, $2, $3, $4, $5, $6, 'RESERVED', $7, $8, $9::jsonb) RETURNING *`,
        [
          randomUUID(),
          userId,
          taskId,
          input.taskId,
          input.modelId ?? null,
          amount,
          input.idempotencyKey,
          now,
          JSON.stringify(bucketAllocations ?? []),
        ],
      );
      const reservation = mapReservation(reservationResult.rows[0] as Record<string, unknown>);
      await client.query(
        'UPDATE wallets SET available_credits = available_credits - $2, reserved_credits = reserved_credits + $2, updated_at = $3 WHERE user_id = $1',
        [userId, amount, now],
      );
      for (const allocation of bucketAllocations ?? []) {
        await client.query(
          `UPDATE wallet_buckets
              SET available_credits = available_credits - $2,
                  reserved_credits = reserved_credits + $2
            WHERE id = $1 AND wallet_id = $3`,
          [allocation.bucketId, allocation.amountCredits, wallet.walletId],
        );
      }
      await client.query(
        `INSERT INTO credit_ledger_entries (id, user_id, task_id, task_key, amount_credits, transaction_type, idempotency_key, reason, available_delta_credits, reserved_delta_credits, consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, 'USAGE_RESERVE', $6, 'Task usage reservation', -$5, $5, 0, $7, $8)`,
        [
          randomUUID(),
          userId,
          taskId,
          input.taskId,
          amount,
          input.idempotencyKey,
          { reservationId: reservation.reservationId },
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
    const providerActualCostUsd = formatUsd(parseUsd(input.providerActualCostUsd));
    const customerBillableCostUsd = formatUsd(parseUsd(input.customerBillableCostUsd));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT * FROM usage_settlements WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        const existing = mapSettlement(duplicate.rows[0] as Record<string, unknown>);
        if (
          existing.reservationId !== input.reservationId ||
          existing.providerActualCostUsd !== providerActualCostUsd ||
          existing.customerBillableCostUsd !== customerBillableCostUsd
        )
          throw new BillingError(
            'IDEMPOTENCY_CONFLICT',
            'Settlement key was reused with different values',
          );
        await client.query('COMMIT');
        return existing;
      }
      const reservationResult = await client.query(
        'SELECT * FROM credit_reservations WHERE id = $1 FOR UPDATE',
        [requireUuid(input.reservationId, 'reservationId')],
      );
      const reservationRow = reservationResult.rows[0] as Record<string, unknown> | undefined;
      if (!reservationRow)
        throw new BillingError('RESERVATION_NOT_FOUND', 'Credit reservation not found');
      const reservation = mapReservation(reservationRow);
      if (reservation.status !== 'RESERVED')
        throw new BillingError(
          'RESERVATION_ALREADY_SETTLED',
          'Credit reservation is already closed',
        );
      const settledCredits = creditsFromUsd(customerBillableCostUsd);
      if (compareCredits(settledCredits, reservation.amountCredits) > 0)
        throw new BillingError(
          'RESERVATION_EXCEEDED',
          'Actual customer cost exceeded reserved credits',
        );
      const releasedCredits = subtractCredits(reservation.amountCredits, settledCredits);
      const absorbedCostUsd = subtractUsd(providerActualCostUsd, customerBillableCostUsd);
      const userId = String(reservation.userId);
      const taskId = taskUuidOrNull(reservation.taskId);
      const now = new Date().toISOString();
      const wallet = mapWallet(await ensureWallet(client, userId));
      const afterSettlement = WalletSchema.parse({
        ...wallet,
        reservedCredits: subtractCredits(wallet.reservedCredits, settledCredits),
        consumedCredits: addCredits(wallet.consumedCredits, settledCredits),
        updatedAt: now,
      });
      const afterRelease = WalletSchema.parse({
        ...afterSettlement,
        availableCredits: addCredits(afterSettlement.availableCredits, releasedCredits),
        reservedCredits: subtractCredits(afterSettlement.reservedCredits, releasedCredits),
        updatedAt: now,
      });
      const result = await client.query(
        `INSERT INTO usage_settlements (id, reservation_id, provider_actual_cost_usd, customer_billable_cost_usd, absorbed_cost_usd, reserved_credits, settled_credits, released_credits, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          randomUUID(),
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
      await client.query(
        'UPDATE wallets SET available_credits = $2, reserved_credits = $3, consumed_credits = $4, updated_at = $5 WHERE user_id = $1',
        [
          userId,
          afterRelease.availableCredits,
          afterRelease.reservedCredits,
          afterRelease.consumedCredits,
          now,
        ],
      );
      await client.query(
        "UPDATE credit_reservations SET status = 'SETTLED', settled_at = $2 WHERE id = $1",
        [reservation.reservationId, now],
      );
      await client.query(
        `INSERT INTO credit_ledger_entries (id, user_id, task_id, task_key, amount_credits, transaction_type, idempotency_key, reason, available_delta_credits, reserved_delta_credits, consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, 'USAGE_SETTLEMENT', $6, 'Actual task usage settlement', 0, -$5, $5, $7, $8)`,
        [
          randomUUID(),
          userId,
          taskId,
          reservation.taskId,
          settledCredits,
          `${input.idempotencyKey}:settlement`,
          {
            reservationId: reservation.reservationId,
            providerActualCostUsd,
            customerBillableCostUsd,
            absorbedCostUsd,
          },
          now,
        ],
      );
      if (releasedCredits !== '0')
        await client.query(
          `INSERT INTO credit_ledger_entries (id, user_id, task_id, task_key, amount_credits, transaction_type, idempotency_key, reason, available_delta_credits, reserved_delta_credits, consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, 'RESERVE_RELEASE', $6, 'Release unused task reservation', $5, -$5, 0, $7, $8)`,
          [
            randomUUID(),
            userId,
            taskId,
            reservation.taskId,
            releasedCredits,
            `${input.idempotencyKey}:release`,
            { reservationId: reservation.reservationId },
            now,
          ],
        );
      let bucketSettlementRemaining = parseCredits(settledCredits);
      for (const allocation of reservation.bucketAllocations) {
        if (bucketSettlementRemaining <= 0n) break;
        const allocationAmount = parseCredits(allocation.amountCredits);
        const consumeAmount =
          allocationAmount < bucketSettlementRemaining
            ? allocationAmount
            : bucketSettlementRemaining;
        await client.query(
          `UPDATE wallet_buckets
              SET reserved_credits = reserved_credits - $2
            WHERE id = $1 AND wallet_id = $3`,
          [allocation.bucketId, formatCredits(consumeAmount), wallet.walletId],
        );
        bucketSettlementRemaining -= consumeAmount;
      }
      let bucketReleaseRemaining = parseCredits(releasedCredits);
      for (const allocation of [...reservation.bucketAllocations].reverse()) {
        if (bucketReleaseRemaining <= 0n) break;
        const allocationAmount = parseCredits(allocation.amountCredits);
        const releaseAmount =
          allocationAmount < bucketReleaseRemaining ? allocationAmount : bucketReleaseRemaining;
        await client.query(
          `UPDATE wallet_buckets
              SET available_credits = available_credits + $2,
                  reserved_credits = reserved_credits - $2
            WHERE id = $1 AND wallet_id = $3`,
          [allocation.bucketId, formatCredits(releaseAmount), wallet.walletId],
        );
        bucketReleaseRemaining -= releaseAmount;
      }
      await client.query('COMMIT');
      return mapSettlement(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listLedger(userId: string): Promise<WalletLedgerEntry[]> {
    const result = await this.pool.query(
      'SELECT * FROM credit_ledger_entries WHERE user_id = $1 ORDER BY created_at ASC, id ASC',
      [requireUuid(userId, 'userId')],
    );
    return result.rows.map((row) => mapLedger(row as Record<string, unknown>));
  }

  async adjustCredits(input: AdjustCreditsInput): Promise<WalletLedgerEntry> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT * FROM credit_ledger_entries WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        const existing = mapLedger(duplicate.rows[0] as Record<string, unknown>);
        const amount = formatCredits(parseCredits(input.amountCredits));
        const expectedDelta = input.direction === 'credit' ? amount : `-${amount}`;
        if (
          existing.userId !== input.userId ||
          existing.amountCredits !== amount ||
          existing.availableDeltaCredits !== expectedDelta
        )
          throw new BillingError(
            'IDEMPOTENCY_CONFLICT',
            'Adjustment key was reused with different values',
          );
        await client.query('COMMIT');
        return existing;
      }
      const userId = requireUuid(input.userId, 'userId');
      const amount = formatCredits(parseCredits(input.amountCredits));
      const wallet = await expireAvailableBuckets(
        client,
        mapWallet(await ensureWallet(client, userId)),
        new Date().toISOString(),
      );
      if (input.direction === 'debit' && compareCredits(wallet.availableCredits, amount) < 0)
        throw new BillingError(
          'ADJUSTMENT_EXCEEDS_BALANCE',
          'Wallet adjustment exceeds available credits',
        );
      const delta = input.direction === 'credit' ? amount : `-${amount}`;
      const now = new Date().toISOString();
      const result = await client.query(
        `INSERT INTO credit_ledger_entries (id, user_id, task_id, amount_credits, transaction_type, idempotency_key, reason, available_delta_credits, reserved_delta_credits, consumed_delta_credits, metadata, created_at)
         VALUES ($1, $2, NULL, $3, 'ADJUSTMENT', $4, $5, $6, 0, 0, $7, $8) RETURNING *`,
        [
          randomUUID(),
          userId,
          amount,
          input.idempotencyKey,
          input.reason,
          delta,
          input.metadata ?? {},
          now,
        ],
      );
      const nextAvailable =
        input.direction === 'credit'
          ? addCredits(wallet.availableCredits, amount)
          : subtractCredits(wallet.availableCredits, amount);
      await client.query(
        'UPDATE wallets SET available_credits = $2, updated_at = $3 WHERE user_id = $1',
        [userId, nextAvailable, now],
      );
      if (input.direction === 'credit') {
        await client.query(
          `INSERT INTO wallet_buckets
             (id, wallet_id, source_type, original_credits, available_credits, reserved_credits,
              expires_at, created_at, idempotency_key, reference_id, plan_cycle)
           VALUES ($1, $2, 'admin_adjustment', $3, $3, 0, NULL, $4, $5, NULL, NULL)`,
          [randomUUID(), wallet.walletId, amount, now, input.idempotencyKey],
        );
      } else {
        const bucketRows = await client.query(
          `SELECT * FROM wallet_buckets
            WHERE wallet_id = $1 AND available_credits > 0
              AND (expires_at IS NULL OR expires_at > now())
            ORDER BY expires_at NULLS LAST, created_at ASC
            FOR UPDATE`,
          [wallet.walletId],
        );
        const allocations = allocateBucketRows(
          bucketRows.rows as Array<Record<string, unknown>>,
          amount,
        );
        const bucketCount = await client.query(
          'SELECT COUNT(*)::int AS count FROM wallet_buckets WHERE wallet_id = $1',
          [wallet.walletId],
        );
        if (Number(bucketCount.rows[0]?.count ?? 0) > 0 && !allocations)
          throw new BillingError(
            'ADJUSTMENT_EXCEEDS_BALANCE',
            'Wallet adjustment exceeds available credit buckets',
          );
        for (const allocation of allocations ?? [])
          await client.query(
            `UPDATE wallet_buckets
                SET available_credits = available_credits - $2
              WHERE id = $1 AND wallet_id = $3`,
            [allocation.bucketId, allocation.amountCredits, wallet.walletId],
          );
      }
      await client.query('COMMIT');
      return mapLedger(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rolloverSubscriptionCredits(input: RolloverSubscriptionCreditsInput): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userId = requireUuid(input.userId, 'userId');
      const wallet = mapWallet(await ensureWallet(client, userId));
      const existing = await client.query(
        `SELECT available_credits
           FROM wallet_buckets
          WHERE wallet_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [wallet.walletId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return formatCredits(parseCredits(String(existing.rows[0].available_credits)));
      }
      const candidates = await client.query(
        `SELECT * FROM wallet_buckets
          WHERE wallet_id = $1
            AND source_type IN ('subscription_monthly', 'SUBSCRIPTION_GRANT')
            AND plan_cycle IS NOT NULL
            AND plan_cycle <> $2
            AND available_credits > 0
            AND (expires_at IS NULL OR expires_at >= $3)
          ORDER BY plan_cycle DESC, created_at DESC
          FOR UPDATE`,
        [wallet.walletId, input.periodStart, input.periodStart],
      );
      const limit = parseCredits(input.monthlyAllocation);
      const source = candidates.rows[0] as Record<string, unknown> | undefined;
      if (!source || limit <= 0n) {
        await client.query('COMMIT');
        return '0';
      }
      const sourceRemaining = parseCredits(String(source.available_credits));
      const amount = formatCredits(sourceRemaining < limit ? sourceRemaining : limit);
      const now = new Date().toISOString();
      await client.query(
        `UPDATE wallet_buckets SET available_credits = available_credits - $2
          WHERE id = $1 AND wallet_id = $3`,
        [String(source.id), amount, wallet.walletId],
      );
      const targetId = randomUUID();
      await client.query(
        `INSERT INTO wallet_buckets
           (id, wallet_id, source_type, original_credits, available_credits, reserved_credits,
            expires_at, created_at, idempotency_key, reference_id, plan_cycle)
         VALUES ($1, $2, 'subscription_monthly', $3, $3, 0, $4, $5, $6, $7, $8)`,
        [
          targetId,
          wallet.walletId,
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
          'Move unused subscription credits into rollover bucket',
          { sourceBucketId: String(source.id), rollover: true },
        ],
        [
          'target',
          amount,
          'Create subscription rollover bucket',
          { bucketId: targetId, rollover: true },
        ],
      ] as const) {
        await client.query(
          `INSERT INTO credit_ledger_entries
             (id, user_id, task_id, task_key, amount_credits, transaction_type,
              idempotency_key, reason, available_delta_credits, reserved_delta_credits,
              consumed_delta_credits, metadata, created_at)
           VALUES ($1, $2, NULL, NULL, $3, 'ADJUSTMENT', $4, $5, $6, 0, 0, $7, $8)`,
          [
            randomUUID(),
            userId,
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
}
