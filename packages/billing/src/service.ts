import type {
  BillingMode,
  CreditReservation,
  UsageSettlement,
  Wallet,
  WalletLedgerEntry,
  WalletBucket,
} from '@astra/contracts';
import type { PlanCatalog } from '@astra/plans';
import { ControlPlaneError, type ControlPlaneService } from '@astra/control-plane';
import { BillingError, InMemoryBillingStore } from './memory.js';
import type {
  AdjustCreditsInput,
  BillingStore,
  GrantCreditsInput,
  RolloverSubscriptionCreditsInput,
} from './ports.js';

export class BillingService {
  constructor(
    private readonly options: {
      store: BillingStore;
      plans: PlanCatalog;
      controlPlane?: ControlPlaneService;
    },
  ) {}

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
    if (this.options.controlPlane) {
      try {
        await this.options.controlPlane.assertTaskAllowed({
          planId: input.planId,
          modelId: input.modelId,
          mode: input.mode,
          requestedCredits: input.amountCredits,
          activeJobs,
          ...(input.activeSeats === undefined ? {} : { activeSeats: input.activeSeats }),
        });
      } catch (error) {
        if (error instanceof ControlPlaneError) {
          throw new BillingError(
            error.code === 'CONTROL_PLANE_UNAVAILABLE'
              ? 'CONTROL_PLANE_UNAVAILABLE'
              : 'CONTROL_PLANE_POLICY_DENIED',
            error.message,
          );
        }
        throw error;
      }
    }
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
