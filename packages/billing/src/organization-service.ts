import type {
  BillingMode,
  CreditReservation,
  OrganizationWallet,
  OrganizationWalletBucket,
  OrganizationWalletLedgerEntry,
  UsageSettlement,
} from '@lyntar/contracts';
import type { PlanCatalog } from '@lyntar/plans';
import { PlanEntitlementError } from '@lyntar/plans';
import { BillingError } from './memory.js';
import type {
  OrganizationBillingStore,
  OrganizationGrantCreditsInput,
  OrganizationReserveCreditsInput,
  OrganizationRolloverSubscriptionCreditsInput,
} from './ports.js';

export class OrganizationBillingService {
  constructor(private readonly options: { store: OrganizationBillingStore; plans: PlanCatalog }) {}

  grantCredits(input: OrganizationGrantCreditsInput): Promise<OrganizationWalletLedgerEntry> {
    return this.options.store.grantCredits(input);
  }

  async reserveTask(input: {
    organizationId: string;
    actorUserId: string;
    roomId?: string | null;
    hostDeviceId?: string | null;
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
    const plan = this.options.plans.get(input.planId);
    if (!plan.pooledCredits) throw new PlanEntitlementError('POOLED_WALLET_NOT_ENABLED');
    const activeJobs =
      input.activeJobs ??
      (await this.options.store.countActiveReservations?.(input.organizationId)) ??
      0;
    this.options.plans.assertTaskAllowed(input.planId, {
      modelId: input.modelId,
      ...(input.modelPlanAccess ? { modelPlanAccess: input.modelPlanAccess } : {}),
      mode: input.mode,
      requestedCredits: input.amountCredits,
      activeJobs,
      ...(input.activeSeats === undefined ? {} : { activeSeats: input.activeSeats }),
    });
    const reservationInput: OrganizationReserveCreditsInput = {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
      ...(input.hostDeviceId === undefined ? {} : { hostDeviceId: input.hostDeviceId }),
      taskId: input.taskId,
      modelId: input.modelId,
      amountCredits: input.amountCredits,
      idempotencyKey: input.idempotencyKey,
    };
    return this.options.store.reserveCredits(reservationInput);
  }

  settleTask(input: {
    reservationId: string;
    idempotencyKey: string;
    providerActualCostUsd: string;
    customerBillableCostUsd: string;
  }): Promise<UsageSettlement> {
    return this.options.store.settleCredits(input);
  }

  getWallet(organizationId: string): Promise<OrganizationWallet> {
    return this.options.store.getWallet(organizationId);
  }

  getReservation(reservationId: string): Promise<CreditReservation | undefined> {
    return this.options.store.getReservation(reservationId);
  }

  getLedger(organizationId: string): Promise<OrganizationWalletLedgerEntry[]> {
    return this.options.store.listLedger(organizationId);
  }

  getBuckets(organizationId: string): Promise<OrganizationWalletBucket[]> {
    return this.options.store.listBuckets?.(organizationId) ?? Promise.resolve([]);
  }

  rolloverSubscriptionCredits(
    input: OrganizationRolloverSubscriptionCreditsInput,
  ): Promise<string> {
    return this.options.store.rolloverSubscriptionCredits?.(input) ?? Promise.resolve('0');
  }
}

export { BillingError };
