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
} from '@lyntar/contracts';
import {
  BillingError,
  type AdjustCreditsInput,
  type BillingStore,
  type GrantCreditsInput,
  type ReserveCreditsInput,
  type SettleCreditsInput,
  addCredits,
  compareCredits,
  creditsFromUsd,
  formatCredits,
  parseCredits,
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
    amountCredits: String(row.amount_credits),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(String(row.created_at)).toISOString(),
    settledAt: row.settled_at ? new Date(String(row.settled_at)).toISOString() : null,
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

export class PostgresBillingStore implements BillingStore {
  constructor(private readonly pool: Pool) {}

  async getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    const result = await this.pool.query('SELECT * FROM credit_reservations WHERE id = $1', [
      requireUuid(reservationId, 'reservationId'),
    ]);
    return result.rows[0] ? mapReservation(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async getWallet(userId: string): Promise<Wallet> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await ensureWallet(client, requireUuid(userId, 'userId'));
      await client.query('COMMIT');
      return mapWallet(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
        await client.query('COMMIT');
        return mapLedger(duplicate.rows[0] as Record<string, unknown>);
      }
      const userId = requireUuid(input.userId, 'userId');
      const amount = formatCredits(parseCredits(input.amountCredits));
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
        await client.query('COMMIT');
        return mapReservation(duplicate.rows[0] as Record<string, unknown>);
      }
      const userId = requireUuid(input.userId, 'userId');
      const taskId = taskUuidOrNull(input.taskId);
      const amount = formatCredits(parseCredits(input.amountCredits));
      const wallet = mapWallet(await ensureWallet(client, userId));
      if (compareCredits(wallet.availableCredits, amount) < 0)
        throw new BillingError('INSUFFICIENT_CREDITS', 'Insufficient credits for task reservation');
      const now = new Date().toISOString();
      const reservationResult = await client.query(
        `INSERT INTO credit_reservations (id, user_id, task_id, task_key, amount_credits, status, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, 'RESERVED', $6, $7) RETURNING *`,
        [randomUUID(), userId, taskId, input.taskId, amount, input.idempotencyKey, now],
      );
      const reservation = mapReservation(reservationResult.rows[0] as Record<string, unknown>);
      await client.query(
        'UPDATE wallets SET available_credits = available_credits - $2, reserved_credits = reserved_credits + $2, updated_at = $3 WHERE user_id = $1',
        [userId, amount, now],
      );
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT * FROM usage_settlements WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        await client.query('COMMIT');
        return mapSettlement(duplicate.rows[0] as Record<string, unknown>);
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
      const settledCredits = creditsFromUsd(input.customerBillableCostUsd);
      if (compareCredits(settledCredits, reservation.amountCredits) > 0)
        throw new BillingError(
          'RESERVATION_EXCEEDED',
          'Actual customer cost exceeded reserved credits',
        );
      const releasedCredits = subtractCredits(reservation.amountCredits, settledCredits);
      const absorbedCostUsd = subtractUsd(
        input.providerActualCostUsd,
        input.customerBillableCostUsd,
      );
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
          input.providerActualCostUsd,
          input.customerBillableCostUsd,
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
            providerActualCostUsd: input.providerActualCostUsd,
            customerBillableCostUsd: input.customerBillableCostUsd,
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
        await client.query('COMMIT');
        return mapLedger(duplicate.rows[0] as Record<string, unknown>);
      }
      const userId = requireUuid(input.userId, 'userId');
      const amount = formatCredits(parseCredits(input.amountCredits));
      const wallet = mapWallet(await ensureWallet(client, userId));
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
      await client.query('COMMIT');
      return mapLedger(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
