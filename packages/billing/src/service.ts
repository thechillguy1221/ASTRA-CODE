import type {
  BillingMode,
  CreditReservation,
  UsageSettlement,
  Wallet,
  WalletLedgerEntry,
} from '@lyntar/contracts';
import type { PlanCatalog } from '@lyntar/plans';
import { BillingError, InMemoryBillingStore } from './memory.js';
import type { AdjustCreditsInput, BillingStore, GrantCreditsInput } from './ports.js';

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
  }): Promise<CreditReservation> {
    this.options.plans.assertTaskAllowed(input.planId, {
      modelId: input.modelId,
      ...(input.modelPlanAccess ? { modelPlanAccess: input.modelPlanAccess } : {}),
      mode: input.mode,
      requestedCredits: input.amountCredits,
      activeJobs: input.activeJobs ?? 0,
    });
    return this.options.store.reserveCredits({
      userId: input.userId,
      taskId: input.taskId,
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

  getWallet(userId: string): Promise<Wallet> {
    return this.options.store.getWallet(userId);
  }

  getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    return this.options.store.getReservation(reservationId);
  }

  getLedger(userId: string): Promise<WalletLedgerEntry[]> {
    return this.options.store.listLedger(userId);
  }
}

export { BillingError, InMemoryBillingStore };
