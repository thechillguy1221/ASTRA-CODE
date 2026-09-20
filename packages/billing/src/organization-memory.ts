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
  type WalletBucketSourceType,
} from '@lyntar/contracts';
import {
  addCredits,
  compareCredits,
  creditsFromUsd,
  formatCredits,
  formatUsd,
  parseCredits,
  parseUsd,
  subtractCredits,
  subtractUsd,
} from './math.js';
import { BillingError } from './memory.js';
import type {
  OrganizationBillingStore,
  OrganizationGrantCreditsInput,
  OrganizationReserveCreditsInput,
  SettleCreditsInput,
} from './ports.js';

function emptyWallet(organizationId: string): OrganizationWallet {
  return OrganizationWalletSchema.parse({
    walletId: randomUUID(),
    organizationId,
    availableCredits: '0',
    reservedCredits: '0',
    consumedCredits: '0',
    updatedAt: new Date().toISOString(),
  });
}

function sourceType(input: OrganizationGrantCreditsInput): WalletBucketSourceType {
  if (input.sourceType) return input.sourceType;
  if (input.transactionType === 'CREDIT_PURCHASE') return 'purchased_topup';
  if (input.transactionType === 'PROMO_CREDIT') return 'promotional';
  if (input.transactionType === 'REFUND') return 'refund_adjustment';
  if (input.transactionType === 'ADJUSTMENT') return 'admin_adjustment';
  return 'subscription_monthly';
}

export class InMemoryOrganizationBillingStore implements OrganizationBillingStore {
  private readonly wallets = new Map<string, OrganizationWallet>();
  private readonly ledger: OrganizationWalletLedgerEntry[] = [];
  private readonly reservations = new Map<string, CreditReservation>();
  private readonly reservationsByKey = new Map<string, CreditReservation>();
  private readonly settlementsByKey = new Map<string, UsageSettlement>();
  private readonly grantsByKey = new Map<string, OrganizationWalletLedgerEntry>();
  private readonly buckets = new Map<string, OrganizationWalletBucket[]>();
  private readonly reservationBuckets = new Map<
    string,
    Array<{ bucketId: string; amount: string }>
  >();
  private readonly rollovers = new Map<string, string>();

  private walletFor(organizationId: string): OrganizationWallet {
    const wallet = this.wallets.get(organizationId) ?? emptyWallet(organizationId);
    this.wallets.set(organizationId, wallet);
    return wallet;
  }

  private bucketsFor(organizationId: string): OrganizationWalletBucket[] {
    const buckets = this.buckets.get(organizationId) ?? [];
    this.buckets.set(organizationId, buckets);
    return buckets;
  }

  private expireAvailableBuckets(organizationId: string, now: string): void {
    const buckets = this.bucketsFor(organizationId);
    const wallet = this.walletFor(organizationId);
    let nextWallet = wallet;
    for (const bucket of buckets) {
      if (!bucket.expiresAt || new Date(bucket.expiresAt).getTime() > new Date(now).getTime())
        continue;
      const amount = bucket.remainingCredits;
      if (amount === '0') continue;
      bucket.remainingCredits = '0';
      nextWallet = OrganizationWalletSchema.parse({
        ...nextWallet,
        availableCredits: subtractCredits(nextWallet.availableCredits, amount),
        updatedAt: now,
      });
      const idempotencyKey = `organization-bucket-expiry:${bucket.id}`;
      if (this.ledger.some((entry) => entry.idempotencyKey === idempotencyKey)) continue;
      this.ledger.push(
        OrganizationWalletLedgerEntrySchema.parse({
          id: randomUUID(),
          organizationId,
          actorUserId: 'system',
          roomId: null,
          taskId: null,
          amountCredits: amount,
          transactionType: 'ADJUSTMENT',
          idempotencyKey,
          reason: 'Expire unused organization credit bucket',
          availableDeltaCredits: `-${amount}`,
          reservedDeltaCredits: '0',
          consumedDeltaCredits: '0',
          createdAt: now,
          metadata: { bucketId: bucket.id, reason: 'bucket_expired' },
        }),
      );
    }
    this.wallets.set(organizationId, nextWallet);
  }

  private allocateBuckets(
    organizationId: string,
    amount: string,
    now: string,
  ): Array<{ bucketId: string; amount: string }> | null {
    const buckets = this.bucketsFor(organizationId)
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
    organizationId: string,
    allocations: Array<{ bucketId: string; amount: string }>,
    amount: string,
  ): void {
    let remaining = parseCredits(amount);
    for (const allocation of [...allocations].reverse()) {
      if (remaining <= 0n) break;
      const bucket = this.bucketsFor(organizationId).find(
        (candidate) => candidate.id === allocation.bucketId,
      );
      if (!bucket) continue;
      const allocationAmount = parseCredits(allocation.amount);
      const released = allocationAmount < remaining ? allocationAmount : remaining;
      bucket.remainingCredits = addCredits(bucket.remainingCredits, formatCredits(released));
      remaining -= released;
    }
  }

  async getWallet(organizationId: string): Promise<OrganizationWallet> {
    this.expireAvailableBuckets(organizationId, new Date().toISOString());
    return { ...this.walletFor(organizationId) };
  }

  async getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    const reservation = this.reservations.get(reservationId);
    return reservation
      ? { ...reservation, bucketAllocations: [...reservation.bucketAllocations] }
      : undefined;
  }

  async countActiveReservations(organizationId: string): Promise<number> {
    return [...this.reservations.values()].filter(
      (reservation) =>
        reservation.organizationId === organizationId && reservation.status === 'RESERVED',
    ).length;
  }

  async grantCredits(input: OrganizationGrantCreditsInput): Promise<OrganizationWalletLedgerEntry> {
    const amount = formatCredits(parseCredits(input.amountCredits));
    const existing = this.grantsByKey.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.organizationId !== input.organizationId ||
        existing.amountCredits !== amount ||
        existing.transactionType !== input.transactionType
      )
        throw new BillingError(
          'IDEMPOTENCY_CONFLICT',
          'Organization credit grant key was reused with different values',
        );
      return { ...existing, metadata: { ...existing.metadata } };
    }
    if (amount === '0')
      throw new BillingError('IDEMPOTENCY_CONFLICT', 'Credit grant must be positive');
    const now = new Date().toISOString();
    const wallet = this.walletFor(input.organizationId);
    const entry = OrganizationWalletLedgerEntrySchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      roomId: input.roomId ?? null,
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
      input.organizationId,
      OrganizationWalletSchema.parse({
        ...wallet,
        availableCredits: addCredits(wallet.availableCredits, amount),
        updatedAt: now,
      }),
    );
    this.ledger.push(entry);
    this.grantsByKey.set(input.idempotencyKey, entry);
    const metadata = input.metadata ?? {};
    this.bucketsFor(input.organizationId).push(
      OrganizationWalletBucketSchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        sourceType: sourceType(input),
        originalCredits: amount,
        remainingCredits: amount,
        idempotencyKey: input.idempotencyKey,
        referenceId:
          input.referenceId ??
          (typeof metadata.referenceId === 'string' ? metadata.referenceId : null),
        planCycle:
          input.planCycle ?? (typeof metadata.planCycle === 'string' ? metadata.planCycle : null),
        expiresAt:
          input.expiresAt ?? (typeof metadata.expiresAt === 'string' ? metadata.expiresAt : null),
        createdAt: now,
      }),
    );
    return { ...entry, metadata: { ...entry.metadata } };
  }

  async listBuckets(organizationId: string): Promise<OrganizationWalletBucket[]> {
    this.expireAvailableBuckets(organizationId, new Date().toISOString());
    return this.bucketsFor(organizationId).map((bucket) => ({ ...bucket }));
  }

  async reserveCredits(input: OrganizationReserveCreditsInput): Promise<CreditReservation> {
    const amount = formatCredits(parseCredits(input.amountCredits));
    const existing = this.reservationsByKey.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.organizationId !== input.organizationId ||
        existing.actorUserId !== input.actorUserId ||
        existing.roomId !== (input.roomId ?? null) ||
        existing.taskId !== input.taskId ||
        existing.modelId !== input.modelId ||
        existing.amountCredits !== amount
      )
        throw new BillingError(
          'IDEMPOTENCY_CONFLICT',
          'Reservation key was reused with different values',
        );
      return { ...existing, bucketAllocations: [...existing.bucketAllocations] };
    }
    this.expireAvailableBuckets(input.organizationId, new Date().toISOString());
    const wallet = this.walletFor(input.organizationId);
    if (compareCredits(wallet.availableCredits, amount) < 0)
      throw new BillingError(
        'INSUFFICIENT_CREDITS',
        'Insufficient organization credits for reservation',
      );
    const now = new Date().toISOString();
    const allocations = this.allocateBuckets(input.organizationId, amount, now);
    if (this.bucketsFor(input.organizationId).length > 0 && !allocations)
      throw new BillingError('INSUFFICIENT_CREDITS', 'Insufficient unexpired organization credits');
    const reservation = CreditReservationSchema.parse({
      reservationId: randomUUID(),
      userId: input.actorUserId,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      roomId: input.roomId ?? null,
      hostDeviceId: input.hostDeviceId ?? null,
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
      input.organizationId,
      OrganizationWalletSchema.parse({
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
      OrganizationWalletLedgerEntrySchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        roomId: input.roomId ?? null,
        taskId: input.taskId,
        amountCredits: amount,
        transactionType: 'USAGE_RESERVE',
        idempotencyKey: input.idempotencyKey,
        reason: 'Organization task usage reservation',
        availableDeltaCredits: `-${amount}`,
        reservedDeltaCredits: amount,
        consumedDeltaCredits: '0',
        createdAt: now,
        metadata: {
          reservationId: reservation.reservationId,
          ...(input.hostDeviceId ? { hostDeviceId: input.hostDeviceId } : {}),
        },
      }),
    );
    return { ...reservation, bucketAllocations: [...reservation.bucketAllocations] };
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
    if (!reservation || !reservation.organizationId)
      throw new BillingError('RESERVATION_NOT_FOUND', 'Organization reservation not found');
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
    const settlement = UsageSettlementSchema.parse({
      settlementId: randomUUID(),
      reservationId: reservation.reservationId,
      organizationId: reservation.organizationId,
      actorUserId: reservation.actorUserId ?? reservation.userId,
      roomId: reservation.roomId ?? null,
      hostDeviceId: reservation.hostDeviceId ?? null,
      providerActualCostUsd,
      customerBillableCostUsd,
      absorbedCostUsd,
      reservedCredits: reservation.amountCredits,
      settledCredits,
      releasedCredits,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    });
    const wallet = this.walletFor(reservation.organizationId);
    const afterSettlement = OrganizationWalletSchema.parse({
      ...wallet,
      reservedCredits: subtractCredits(wallet.reservedCredits, settledCredits),
      consumedCredits: addCredits(wallet.consumedCredits, settledCredits),
      updatedAt: now,
    });
    const afterRelease = OrganizationWalletSchema.parse({
      ...afterSettlement,
      availableCredits: addCredits(afterSettlement.availableCredits, releasedCredits),
      reservedCredits: subtractCredits(afterSettlement.reservedCredits, releasedCredits),
      updatedAt: now,
    });
    this.wallets.set(reservation.organizationId, afterRelease);
    if (releasedCredits !== '0')
      this.releaseBuckets(
        reservation.organizationId,
        this.reservationBuckets.get(reservation.reservationId) ?? [],
        releasedCredits,
      );
    this.ledger.push(
      OrganizationWalletLedgerEntrySchema.parse({
        id: randomUUID(),
        organizationId: reservation.organizationId,
        actorUserId: reservation.actorUserId ?? reservation.userId,
        roomId: reservation.roomId ?? null,
        taskId: reservation.taskId,
        amountCredits: settledCredits,
        transactionType: 'USAGE_SETTLEMENT',
        idempotencyKey: `${input.idempotencyKey}:settlement`,
        reason: 'Actual organization task usage settlement',
        availableDeltaCredits: '0',
        reservedDeltaCredits: `-${settledCredits}`,
        consumedDeltaCredits: settledCredits,
        createdAt: now,
        metadata: {
          reservationId: reservation.reservationId,
          providerActualCostUsd,
          customerBillableCostUsd,
          absorbedCostUsd,
        },
      }),
    );
    if (releasedCredits !== '0')
      this.ledger.push(
        OrganizationWalletLedgerEntrySchema.parse({
          id: randomUUID(),
          organizationId: reservation.organizationId,
          actorUserId: reservation.actorUserId ?? reservation.userId,
          roomId: reservation.roomId ?? null,
          taskId: reservation.taskId,
          amountCredits: releasedCredits,
          transactionType: 'RESERVE_RELEASE',
          idempotencyKey: `${input.idempotencyKey}:release`,
          reason: 'Release unused organization task reservation',
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
    this.settlementsByKey.set(input.idempotencyKey, settlement);
    return { ...settlement };
  }

  async rolloverSubscriptionCredits(input: {
    organizationId: string;
    actorUserId: string;
    monthlyAllocation: string;
    periodStart: string;
    newExpiresAt?: string | null;
    idempotencyKey: string;
    referenceId?: string | null;
  }): Promise<string> {
    const existing = this.rollovers.get(input.idempotencyKey);
    if (existing !== undefined) return existing;
    const limit = parseCredits(input.monthlyAllocation);
    const periodStart = new Date(input.periodStart).getTime();
    const source = this.bucketsFor(input.organizationId)
      .filter(
        (bucket) =>
          bucket.sourceType === 'subscription_monthly' &&
          bucket.planCycle !== null &&
          bucket.planCycle !== input.periodStart &&
          parseCredits(bucket.remainingCredits) > 0n &&
          (!bucket.expiresAt || new Date(bucket.expiresAt).getTime() >= periodStart),
      )
      .sort((left, right) => (right.planCycle ?? '').localeCompare(left.planCycle ?? ''))[0];
    if (!source || limit <= 0n) {
      this.rollovers.set(input.idempotencyKey, '0');
      return '0';
    }
    const amount = formatCredits(
      parseCredits(source.remainingCredits) < limit ? parseCredits(source.remainingCredits) : limit,
    );
    source.remainingCredits = subtractCredits(source.remainingCredits, amount);
    const now = new Date().toISOString();
    const target = OrganizationWalletBucketSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      sourceType: 'subscription_monthly',
      originalCredits: amount,
      remainingCredits: amount,
      idempotencyKey: input.idempotencyKey,
      referenceId: input.referenceId ?? null,
      planCycle: input.periodStart,
      expiresAt: input.newExpiresAt ?? null,
      createdAt: now,
    });
    this.bucketsFor(input.organizationId).push(target);
    this.ledger.push(
      OrganizationWalletLedgerEntrySchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        roomId: null,
        taskId: null,
        amountCredits: amount,
        transactionType: 'ADJUSTMENT',
        idempotencyKey: `${input.idempotencyKey}:source`,
        reason: 'Move unused organization subscription credits into rollover bucket',
        availableDeltaCredits: `-${amount}`,
        reservedDeltaCredits: '0',
        consumedDeltaCredits: '0',
        createdAt: now,
        metadata: { sourceBucketId: source.id, rollover: true },
      }),
    );
    this.ledger.push(
      OrganizationWalletLedgerEntrySchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        roomId: null,
        taskId: null,
        amountCredits: amount,
        transactionType: 'ADJUSTMENT',
        idempotencyKey: `${input.idempotencyKey}:target`,
        reason: 'Create organization subscription rollover bucket',
        availableDeltaCredits: amount,
        reservedDeltaCredits: '0',
        consumedDeltaCredits: '0',
        createdAt: now,
        metadata: { bucketId: target.id, rollover: true },
      }),
    );
    this.rollovers.set(input.idempotencyKey, amount);
    return amount;
  }

  async listLedger(organizationId: string): Promise<OrganizationWalletLedgerEntry[]> {
    return this.ledger
      .filter((entry) => entry.organizationId === organizationId)
      .map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
  }
}
