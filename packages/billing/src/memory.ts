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
  WalletBucketSchema,
  type WalletBucket,
  type WalletBucketSourceType,
} from '@lyntar/contracts';
import {
  addCredits,
  compareCredits,
  creditsFromUsd,
  formatUsd,
  formatCredits,
  parseUsd,
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
  private readonly buckets = new Map<string, WalletBucket[]>();
  private readonly reservationBuckets = new Map<
    string,
    Array<{ bucketId: string; amount: string }>
  >();
  private readonly rollovers = new Map<string, string>();

  private walletFor(userId: string): Wallet {
    const wallet = this.wallets.get(userId) ?? emptyWallet(userId);
    this.wallets.set(userId, wallet);
    return wallet;
  }

  private bucketsFor(userId: string): WalletBucket[] {
    const buckets = this.buckets.get(userId) ?? [];
    this.buckets.set(userId, buckets);
    return buckets;
  }

  private expireAvailableBuckets(userId: string, now: string): void {
    const buckets = this.bucketsFor(userId);
    const wallet = this.walletFor(userId);
    let nextWallet = wallet;
    for (const bucket of buckets) {
      if (!bucket.expiresAt || new Date(bucket.expiresAt).getTime() > new Date(now).getTime())
        continue;
      const amount = bucket.remainingCredits;
      if (amount === '0') continue;
      bucket.remainingCredits = '0';
      nextWallet = WalletSchema.parse({
        ...nextWallet,
        availableCredits: subtractCredits(nextWallet.availableCredits, amount),
        updatedAt: now,
      });
      const idempotencyKey = `bucket-expiry:${bucket.id}`;
      if (!this.ledger.some((entry) => entry.idempotencyKey === idempotencyKey))
        this.ledger.push(
          WalletLedgerEntrySchema.parse({
            id: randomUUID(),
            userId,
            taskId: null,
            amountCredits: amount,
            transactionType: 'ADJUSTMENT',
            idempotencyKey,
            reason: 'Expire unused credit bucket',
            availableDeltaCredits: `-${amount}`,
            reservedDeltaCredits: '0',
            consumedDeltaCredits: '0',
            createdAt: now,
            metadata: { bucketId: bucket.id, reason: 'bucket_expired' },
          }),
        );
    }
    this.wallets.set(userId, nextWallet);
  }

  private sourceType(input: GrantCreditsInput): WalletBucketSourceType {
    if (input.sourceType) return input.sourceType;
    if (input.transactionType === 'CREDIT_PURCHASE') return 'purchased_topup';
    if (input.transactionType === 'PROMO_CREDIT') return 'promotional';
    if (input.transactionType === 'REFUND') return 'refund_adjustment';
    if (input.transactionType === 'ADJUSTMENT') return 'admin_adjustment';
    return 'subscription_monthly';
  }

  private allocateBuckets(
    userId: string,
    amount: string,
    now: string,
  ): Array<{ bucketId: string; amount: string }> | null {
    const buckets = this.bucketsFor(userId)
      .filter(
        (bucket) =>
          !bucket.expiresAt || new Date(bucket.expiresAt).getTime() > new Date(now).getTime(),
      )
      .sort((left, right) => {
        const leftExpiry = left.expiresAt
          ? new Date(left.expiresAt).getTime()
          : Number.POSITIVE_INFINITY;
        const rightExpiry = right.expiresAt
          ? new Date(right.expiresAt).getTime()
          : Number.POSITIVE_INFINITY;
        return leftExpiry - rightExpiry || left.createdAt.localeCompare(right.createdAt);
      });
    let remaining = parseCredits(amount);
    const allocations: Array<{ bucketId: string; amount: string }> = [];
    for (const bucket of buckets) {
      if (remaining <= 0n) break;
      const available = parseCredits(bucket.remainingCredits);
      if (available <= 0n) continue;
      const allocated = available < remaining ? available : remaining;
      allocations.push({ bucketId: bucket.id, amount: formatCredits(allocated) });
      remaining -= allocated;
    }
    if (remaining > 0n) return null;
    for (const allocation of allocations) {
      const bucket = buckets.find((candidate) => candidate.id === allocation.bucketId);
      if (bucket)
        bucket.remainingCredits = subtractCredits(bucket.remainingCredits, allocation.amount);
    }
    return allocations;
  }

  private releaseBuckets(
    userId: string,
    allocations: Array<{ bucketId: string; amount: string }>,
    amount: string,
  ): void {
    let remaining = parseCredits(amount);
    for (const allocation of [...allocations].reverse()) {
      if (remaining <= 0n) break;
      const bucket = this.bucketsFor(userId).find(
        (candidate) => candidate.id === allocation.bucketId,
      );
      if (!bucket) continue;
      const released =
        parseCredits(allocation.amount) < remaining ? parseCredits(allocation.amount) : remaining;
      bucket.remainingCredits = addCredits(bucket.remainingCredits, formatCredits(released));
      remaining -= released;
    }
  }

  async getWallet(userId: string): Promise<Wallet> {
    this.expireAvailableBuckets(userId, new Date().toISOString());
    const wallet = this.wallets.get(userId) ?? emptyWallet(userId);
    this.wallets.set(userId, wallet);
    return { ...wallet };
  }

  async getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    const reservation = this.reservations.get(reservationId);
    return reservation ? { ...reservation } : undefined;
  }

  async countActiveReservations(userId: string): Promise<number> {
    return [...this.reservations.values()].filter(
      (reservation) => reservation.userId === userId && reservation.status === 'RESERVED',
    ).length;
  }

  async grantCredits(input: GrantCreditsInput): Promise<WalletLedgerEntry> {
    const existing = this.grantsByKey.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.userId !== input.userId ||
        existing.amountCredits !== formatCredits(parseCredits(input.amountCredits)) ||
        existing.transactionType !== input.transactionType
      )
        throw new BillingError(
          'IDEMPOTENCY_CONFLICT',
          'Credit grant key was reused with different values',
        );
      return { ...existing, metadata: { ...existing.metadata } };
    }
    const amount = formatCredits(parseCredits(input.amountCredits));
    if (amount === '0')
      throw new BillingError('IDEMPOTENCY_CONFLICT', 'Credit grant must be positive');
    this.expireAvailableBuckets(input.userId, new Date().toISOString());
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
    const metadata = input.metadata ?? {};
    const expiresAt =
      input.expiresAt ?? (typeof metadata.expiresAt === 'string' ? metadata.expiresAt : null);
    const referenceId =
      input.referenceId ?? (typeof metadata.referenceId === 'string' ? metadata.referenceId : null);
    const planCycle =
      input.planCycle ?? (typeof metadata.planCycle === 'string' ? metadata.planCycle : null);
    const bucket = WalletBucketSchema.parse({
      id: randomUUID(),
      userId: input.userId,
      sourceType: this.sourceType(input),
      originalCredits: amount,
      remainingCredits: amount,
      idempotencyKey: input.idempotencyKey,
      referenceId,
      planCycle,
      expiresAt,
      createdAt: now,
    });
    this.bucketsFor(input.userId).push(bucket);
    return { ...entry, metadata: { ...entry.metadata } };
  }

  async listBuckets(userId: string): Promise<WalletBucket[]> {
    this.expireAvailableBuckets(userId, new Date().toISOString());
    return this.bucketsFor(userId).map((bucket) => ({ ...bucket }));
  }

  async reserveCredits(input: ReserveCreditsInput): Promise<CreditReservation> {
    const existing = this.reservationsByKey.get(input.idempotencyKey);
    if (existing) {
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
      return { ...existing };
    }
    const amount = formatCredits(parseCredits(input.amountCredits));
    this.expireAvailableBuckets(input.userId, new Date().toISOString());
    const wallet = this.walletFor(input.userId);
    if (compareCredits(wallet.availableCredits, amount) < 0)
      throw new BillingError('INSUFFICIENT_CREDITS', 'Insufficient credits for task reservation');
    const now = new Date().toISOString();
    const allocations = this.allocateBuckets(input.userId, amount, now);
    const reservation = CreditReservationSchema.parse({
      reservationId: randomUUID(),
      userId: input.userId,
      taskId: input.taskId,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      amountCredits: amount,
      status: 'RESERVED',
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      settledAt: null,
      bucketAllocations:
        allocations?.map((allocation) => ({
          bucketId: allocation.bucketId,
          amountCredits: allocation.amount,
        })) ?? [],
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
    if (allocations) this.reservationBuckets.set(reservation.reservationId, allocations);
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
    const providerActualCostUsd = formatUsd(parseUsd(input.providerActualCostUsd));
    const customerBillableCostUsd = formatUsd(parseUsd(input.customerBillableCostUsd));
    const existing = this.settlementsByKey.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.reservationId !== input.reservationId ||
        existing.providerActualCostUsd !== providerActualCostUsd ||
        existing.customerBillableCostUsd !== customerBillableCostUsd
      )
        throw new BillingError(
          'IDEMPOTENCY_CONFLICT',
          'Settlement key was reused with different values',
        );
      return { ...existing };
    }
    const reservation = this.reservations.get(input.reservationId);
    if (!reservation)
      throw new BillingError('RESERVATION_NOT_FOUND', 'Credit reservation not found');
    if (reservation.status !== 'RESERVED')
      throw new BillingError('RESERVATION_ALREADY_SETTLED', 'Credit reservation is already closed');
    const settledCredits = creditsFromUsd(customerBillableCostUsd);
    if (compareCredits(settledCredits, reservation.amountCredits) > 0)
      throw new BillingError(
        'RESERVATION_EXCEEDED',
        'Actual customer cost exceeded reserved credits',
      );
    const releasedCredits = subtractCredits(reservation.amountCredits, settledCredits);
    const absorbedCostUsd = subtractUsd(providerActualCostUsd, customerBillableCostUsd);
    const now = new Date().toISOString();
    const settlement = UsageSettlementSchema.parse({
      settlementId: randomUUID(),
      reservationId: reservation.reservationId,
      providerActualCostUsd,
      customerBillableCostUsd,
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
    if (releasedCredits !== '0')
      this.releaseBuckets(
        reservation.userId,
        this.reservationBuckets.get(reservation.reservationId) ?? [],
        releasedCredits,
      );
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
    if (existing) {
      const expectedDelta =
        input.direction === 'credit'
          ? formatCredits(parseCredits(input.amountCredits))
          : `-${formatCredits(parseCredits(input.amountCredits))}`;
      if (
        existing.userId !== input.userId ||
        existing.amountCredits !== formatCredits(parseCredits(input.amountCredits)) ||
        existing.availableDeltaCredits !== expectedDelta
      )
        throw new BillingError(
          'IDEMPOTENCY_CONFLICT',
          'Adjustment key was reused with different values',
        );
      return { ...existing, metadata: { ...existing.metadata } };
    }
    const amount = formatCredits(parseCredits(input.amountCredits));
    this.expireAvailableBuckets(input.userId, new Date().toISOString());
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
    if (input.direction === 'credit') {
      const now = new Date().toISOString();
      this.bucketsFor(input.userId).push(
        WalletBucketSchema.parse({
          id: randomUUID(),
          userId: input.userId,
          sourceType: 'admin_adjustment',
          originalCredits: amount,
          remainingCredits: amount,
          idempotencyKey: input.idempotencyKey,
          referenceId: null,
          planCycle: null,
          expiresAt: null,
          createdAt: now,
        }),
      );
    } else {
      this.allocateBuckets(input.userId, amount, new Date().toISOString());
    }
    return { ...entry, metadata: { ...entry.metadata } };
  }

  async rolloverSubscriptionCredits(input: {
    userId: string;
    monthlyAllocation: string;
    periodStart: string;
    newExpiresAt?: string | null;
    idempotencyKey: string;
    referenceId?: string | null;
  }): Promise<string> {
    const existing = this.rollovers.get(input.idempotencyKey);
    if (existing !== undefined) return existing;
    const limit = parseCredits(input.monthlyAllocation);
    const candidates = this.bucketsFor(input.userId)
      .filter(
        (bucket) =>
          bucket.sourceType === 'subscription_monthly' &&
          bucket.planCycle !== null &&
          bucket.planCycle !== input.periodStart &&
          parseCredits(bucket.remainingCredits) > 0 &&
          (!bucket.expiresAt ||
            new Date(bucket.expiresAt).getTime() >= new Date(input.periodStart).getTime()),
      )
      .sort((left, right) => (right.planCycle ?? '').localeCompare(left.planCycle ?? ''));
    const source = candidates[0];
    if (!source || limit <= 0n) {
      this.rollovers.set(input.idempotencyKey, '0');
      return '0';
    }
    const amount = formatCredits(
      parseCredits(source.remainingCredits) < limit ? parseCredits(source.remainingCredits) : limit,
    );
    source.remainingCredits = '0';
    const now = new Date().toISOString();
    const rolloverBucket = WalletBucketSchema.parse({
      id: randomUUID(),
      userId: input.userId,
      sourceType: 'subscription_monthly',
      originalCredits: amount,
      remainingCredits: amount,
      idempotencyKey: input.idempotencyKey,
      referenceId: input.referenceId ?? null,
      planCycle: input.periodStart,
      expiresAt: input.newExpiresAt ?? null,
      createdAt: now,
    });
    this.bucketsFor(input.userId).push(rolloverBucket);
    this.ledger.push(
      WalletLedgerEntrySchema.parse({
        id: randomUUID(),
        userId: input.userId,
        taskId: null,
        amountCredits: amount,
        transactionType: 'ADJUSTMENT',
        idempotencyKey: `${input.idempotencyKey}:source`,
        reason: 'Move unused subscription credits into rollover bucket',
        availableDeltaCredits: `-${amount}`,
        reservedDeltaCredits: '0',
        consumedDeltaCredits: '0',
        createdAt: now,
        metadata: { sourceBucketId: source.id, rollover: true },
      }),
    );
    this.ledger.push(
      WalletLedgerEntrySchema.parse({
        id: randomUUID(),
        userId: input.userId,
        taskId: null,
        amountCredits: amount,
        transactionType: 'ADJUSTMENT',
        idempotencyKey: `${input.idempotencyKey}:target`,
        reason: 'Create subscription rollover bucket',
        availableDeltaCredits: amount,
        reservedDeltaCredits: '0',
        consumedDeltaCredits: '0',
        createdAt: now,
        metadata: { bucketId: rolloverBucket.id, rollover: true },
      }),
    );
    this.rollovers.set(input.idempotencyKey, amount);
    return amount;
  }
}
