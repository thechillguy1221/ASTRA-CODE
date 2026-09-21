import type {
  BillingMode,
  CreditReservation,
  OrganizationWallet,
  OrganizationWalletBucket,
  OrganizationWalletLedgerEntry,
  UsageSettlement,
} from '@astra/contracts';
import type { PlanCatalog } from '@astra/plans';
import { PlanEntitlementError } from '@astra/plans';
import { ControlPlaneError, type ControlPlaneService } from '@astra/control-plane';
import { BillingError } from './memory.js';
import type {
  OrganizationBillingStore,
  OrganizationGrantCreditsInput,
  OrganizationReserveCreditsInput,
  OrganizationRolloverSubscriptionCreditsInput,
} from './ports.js';

export class OrganizationBillingService {
  constructor(
    private readonly options: {
      store: OrganizationBillingStore;
      plans: PlanCatalog;
      controlPlane?: ControlPlaneService;
    },
  ) {}

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
