import { randomUUID } from 'node:crypto';
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
  addCredits,
  compareCredits,
  creditsFromUsd,
  formatCredits,
  parseCredits,
  subtractCredits,
  subtractUsd,
} from './math.js';
import type {
  BillingStore,
  AdjustCreditsInput,
  GrantCreditsInput,
  ReserveCreditsInput,
  SettleCreditsInput,
} from './ports.js';

export class BillingError extends Error {
  constructor(
    public readonly code:
      | 'INSUFFICIENT_CREDITS'
      | 'RESERVATION_NOT_FOUND'
      | 'RESERVATION_ALREADY_SETTLED'
      | 'RESERVATION_EXCEEDED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'ADJUSTMENT_EXCEEDS_BALANCE',
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

function emptyWallet(userId: string): Wallet {
  return WalletSchema.parse({
    walletId: randomUUID(),
    userId,
    availableCredits: '0',
    reservedCredits: '0',
    consumedCredits: '0',
    updatedAt: new Date().toISOString(),
  });
}

export class InMemoryBillingStore implements BillingStore {
  private readonly wallets = new Map<string, Wallet>();
  private readonly ledger: WalletLedgerEntry[] = [];
  private readonly reservations = new Map<string, CreditReservation>();
  private readonly reservationsByKey = new Map<string, CreditReservation>();
  private readonly settlements = new Map<string, UsageSettlement>();
  private readonly settlementsByKey = new Map<string, UsageSettlement>();
  private readonly grantsByKey = new Map<string, WalletLedgerEntry>();

  private walletFor(userId: string): Wallet {
    const wallet = this.wallets.get(userId) ?? emptyWallet(userId);
    this.wallets.set(userId, wallet);
    return wallet;
  }

  async getWallet(userId: string): Promise<Wallet> {
    const wallet = this.wallets.get(userId) ?? emptyWallet(userId);
    this.wallets.set(userId, wallet);
    return { ...wallet };
  }

  async getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    const reservation = this.reservations.get(reservationId);
    return reservation ? { ...reservation } : undefined;
  }

  async grantCredits(input: GrantCreditsInput): Promise<WalletLedgerEntry> {
    const existing = this.grantsByKey.get(input.idempotencyKey);
    if (existing) return { ...existing, metadata: { ...existing.metadata } };
    const amount = formatCredits(parseCredits(input.amountCredits));
    if (amount === '0')
      throw new BillingError('IDEMPOTENCY_CONFLICT', 'Credit grant must be positive');
    const wallet = this.walletFor(input.userId);
    const now = new Date().toISOString();
    const entry = WalletLedgerEntrySchema.parse({
      id: randomUUID(),
      userId: input.userId,
      taskId: input.taskId ?? null,
      amountCredits: amount,
      transactionType: input.transactionType,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      availableDeltaCredits: amount,
      reservedDeltaCredits: '0',
      consumedDeltaCredits: '0',
      createdAt: now,
      metadata: input.metadata ?? {},
    });
    this.wallets.set(
      input.userId,
      WalletSchema.parse({
        ...wallet,
        availableCredits: addCredits(wallet.availableCredits, amount),
        updatedAt: now,
      }),
    );
    this.ledger.push(entry);
    this.grantsByKey.set(input.idempotencyKey, entry);
    return { ...entry, metadata: { ...entry.metadata } };
  }

  async reserveCredits(input: ReserveCreditsInput): Promise<CreditReservation> {
    const existing = this.reservationsByKey.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.userId !== input.userId ||
        existing.amountCredits !== formatCredits(parseCredits(input.amountCredits))
      )
        throw new BillingError(
          'IDEMPOTENCY_CONFLICT',
          'Reservation key was reused with different values',
        );
      return { ...existing };
    }
    const amount = formatCredits(parseCredits(input.amountCredits));
    const wallet = this.walletFor(input.userId);
    if (compareCredits(wallet.availableCredits, amount) < 0)
      throw new BillingError('INSUFFICIENT_CREDITS', 'Insufficient credits for task reservation');
    const now = new Date().toISOString();
    const reservation = CreditReservationSchema.parse({
      reservationId: randomUUID(),
      userId: input.userId,
      taskId: input.taskId,
      amountCredits: amount,
      status: 'RESERVED',
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      settledAt: null,
    });
    this.wallets.set(
      input.userId,
      WalletSchema.parse({
        ...wallet,
        availableCredits: subtractCredits(wallet.availableCredits, amount),
        reservedCredits: addCredits(wallet.reservedCredits, amount),
        updatedAt: now,
      }),
    );
    this.reservations.set(reservation.reservationId, reservation);
    this.reservationsByKey.set(input.idempotencyKey, reservation);
    this.ledger.push(
      WalletLedgerEntrySchema.parse({
        id: randomUUID(),
        userId: input.userId,
        taskId: input.taskId,
        amountCredits: amount,
        transactionType: 'USAGE_RESERVE',
        idempotencyKey: input.idempotencyKey,
        reason: 'Task usage reservation',
        availableDeltaCredits: `-${amount}`,
        reservedDeltaCredits: amount,
        consumedDeltaCredits: '0',
        createdAt: now,
        metadata: { reservationId: reservation.reservationId },
      }),
    );
    return { ...reservation };
  }

  async settleCredits(input: SettleCreditsInput): Promise<UsageSettlement> {
    const existing = this.settlementsByKey.get(input.idempotencyKey);
    if (existing) return { ...existing };
    const reservation = this.reservations.get(input.reservationId);
    if (!reservation)
      throw new BillingError('RESERVATION_NOT_FOUND', 'Credit reservation not found');
    if (reservation.status !== 'RESERVED')
      throw new BillingError('RESERVATION_ALREADY_SETTLED', 'Credit reservation is already closed');
    const settledCredits = creditsFromUsd(input.customerBillableCostUsd);
    if (compareCredits(settledCredits, reservation.amountCredits) > 0)
      throw new BillingError(
        'RESERVATION_EXCEEDED',
        'Actual customer cost exceeded reserved credits',
      );
    const releasedCredits = subtractCredits(reservation.amountCredits, settledCredits);
    const absorbedCostUsd = subtractUsd(input.providerActualCostUsd, input.customerBillableCostUsd);
    const now = new Date().toISOString();
    const settlement = UsageSettlementSchema.parse({
      settlementId: randomUUID(),
      reservationId: reservation.reservationId,
      providerActualCostUsd: input.providerActualCostUsd,
      customerBillableCostUsd: input.customerBillableCostUsd,
      absorbedCostUsd,
      reservedCredits: reservation.amountCredits,
      settledCredits,
      releasedCredits,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    });
    const wallet = this.walletFor(reservation.userId);
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
    this.wallets.set(reservation.userId, afterRelease);
    this.ledger.push(
      WalletLedgerEntrySchema.parse({
        id: randomUUID(),
        userId: reservation.userId,
        taskId: reservation.taskId,
        amountCredits: settledCredits,
        transactionType: 'USAGE_SETTLEMENT',
        idempotencyKey: `${input.idempotencyKey}:settlement`,
        reason: 'Actual task usage settlement',
        availableDeltaCredits: '0',
        reservedDeltaCredits: `-${settledCredits}`,
        consumedDeltaCredits: settledCredits,
        createdAt: now,
        metadata: {
          reservationId: reservation.reservationId,
          providerActualCostUsd: input.providerActualCostUsd,
          customerBillableCostUsd: input.customerBillableCostUsd,
          absorbedCostUsd,
        },
      }),
    );
    if (releasedCredits !== '0')
      this.ledger.push(
        WalletLedgerEntrySchema.parse({
          id: randomUUID(),
          userId: reservation.userId,
          taskId: reservation.taskId,
          amountCredits: releasedCredits,
          transactionType: 'RESERVE_RELEASE',
          idempotencyKey: `${input.idempotencyKey}:release`,
          reason: 'Release unused task reservation',
          availableDeltaCredits: releasedCredits,
          reservedDeltaCredits: `-${releasedCredits}`,
          consumedDeltaCredits: '0',
          createdAt: now,
          metadata: { reservationId: reservation.reservationId },
        }),
      );
    const closed = CreditReservationSchema.parse({
      ...reservation,
      status: 'SETTLED',
      settledAt: now,
    });
    this.reservations.set(reservation.reservationId, closed);
    this.reservationsByKey.set(reservation.idempotencyKey, closed);
    this.settlements.set(settlement.settlementId, settlement);
    this.settlementsByKey.set(input.idempotencyKey, settlement);
    return { ...settlement };
  }

  async listLedger(userId: string): Promise<WalletLedgerEntry[]> {
    return this.ledger
      .filter((entry) => entry.userId === userId)
      .map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
  }

  async adjustCredits(input: AdjustCreditsInput): Promise<WalletLedgerEntry> {
    const existing = this.ledger.find((entry) => entry.idempotencyKey === input.idempotencyKey);
    if (existing) return { ...existing, metadata: { ...existing.metadata } };
    const amount = formatCredits(parseCredits(input.amountCredits));
    const wallet = this.walletFor(input.userId);
    if (input.direction === 'debit' && compareCredits(wallet.availableCredits, amount) < 0)
      throw new BillingError(
        'ADJUSTMENT_EXCEEDS_BALANCE',
        'Wallet adjustment exceeds available credits',
      );
    const now = new Date().toISOString();
    const delta = input.direction === 'credit' ? amount : `-${amount}`;
    const entry = WalletLedgerEntrySchema.parse({
      id: randomUUID(),
      userId: input.userId,
      taskId: null,
      amountCredits: amount,
      transactionType: 'ADJUSTMENT',
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      availableDeltaCredits: delta,
      reservedDeltaCredits: '0',
      consumedDeltaCredits: '0',
      createdAt: now,
      metadata: input.metadata ?? {},
    });
    this.wallets.set(
      input.userId,
      WalletSchema.parse({
        ...wallet,
        availableCredits:
          input.direction === 'credit'
            ? addCredits(wallet.availableCredits, amount)
            : subtractCredits(wallet.availableCredits, amount),
        updatedAt: now,
      }),
    );
    this.ledger.push(entry);
    return { ...entry, metadata: { ...entry.metadata } };
  }
}
