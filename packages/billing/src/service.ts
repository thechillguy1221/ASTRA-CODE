import type {
  BillingMode,
  CreditReservation,
  UsageSettlement,
  Wallet,
  WalletLedgerEntry,
  WalletBucket,
} from '@lyntar/contracts';
import type { PlanCatalog } from '@lyntar/plans';
import { BillingError, InMemoryBillingStore } from './memory.js';
import type {
  AdjustCreditsInput,
  BillingStore,
  GrantCreditsInput,
  RolloverSubscriptionCreditsInput,
} from './ports.js';

export class BillingService {
  constructor(private readonly options: { store: BillingStore; plans: PlanCatalog }) {}

  async grantCredits(input: GrantCreditsInput): Promise<WalletLedgerEntry> {
    return this.options.store.grantCredits(input);
  }

  async reserveTask(input: {
    userId: string;
    planId: string;
    taskId: string;
    modelId: string;
    modelPlanAccess?: string[];
    mode: BillingMode;
    amountCredits: string;
    idempotencyKey: string;
    activeJobs?: number;
    activeSeats?: number;
  }): Promise<CreditReservation> {
    const activeJobs =
      input.activeJobs ?? (await this.options.store.countActiveReservations?.(input.userId)) ?? 0;
    this.options.plans.assertTaskAllowed(input.planId, {
      modelId: input.modelId,
      ...(input.modelPlanAccess ? { modelPlanAccess: input.modelPlanAccess } : {}),
      mode: input.mode,
      requestedCredits: input.amountCredits,
      activeJobs,
      ...(input.activeSeats === undefined ? {} : { activeSeats: input.activeSeats }),
    });
    return this.options.store.reserveCredits({
      userId: input.userId,
      taskId: input.taskId,
      modelId: input.modelId,
      amountCredits: input.amountCredits,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async settleTask(input: {
    reservationId: string;
    idempotencyKey: string;
    providerActualCostUsd: string;
    customerBillableCostUsd: string;
  }): Promise<UsageSettlement> {
    return this.options.store.settleCredits(input);
  }

  async adjustCredits(input: AdjustCreditsInput): Promise<WalletLedgerEntry> {
    return this.options.store.adjustCredits(input);
  }

  async rolloverSubscriptionCredits(input: RolloverSubscriptionCreditsInput): Promise<string> {
    return (await this.options.store.rolloverSubscriptionCredits?.(input)) ?? '0';
  }

  getWallet(userId: string): Promise<Wallet> {
    return this.options.store.getWallet(userId);
  }

  getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    return this.options.store.getReservation(reservationId);
  }

  getLedger(userId: string): Promise<WalletLedgerEntry[]> {
    return this.options.store.listLedger(userId);
  }

  getBuckets(userId: string): Promise<WalletBucket[]> {
    return this.options.store.listBuckets?.(userId) ?? Promise.resolve([]);
  }
}

export { BillingError, InMemoryBillingStore };
