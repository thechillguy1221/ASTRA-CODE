import { PlanSchema, type BillingMode, type Plan } from '@astra/contracts';

export * from './pricing.js';

function compareCredits(left: string, right: string): -1 | 0 | 1 {
  const scale = 10_000_000n;
  const parse = (value: string): bigint => {
    const [whole, fraction = ''] = value.split('.');
    if (!/^\d+(?:\.\d+)?$/.test(value) || fraction.length > 7)
      throw new Error(`Invalid credit amount: ${value}`);
    return BigInt(whole ?? '0') * scale + BigInt((fraction + '0'.repeat(7)).slice(0, 7));
  };
  const a = parse(left);
  const b = parse(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export class PlanEntitlementError extends Error {
  constructor(
    public readonly code:
      | 'MODEL_NOT_ALLOWED'
      | 'MODE_NOT_ALLOWED'
      | 'TASK_BUDGET_EXCEEDED'
      | 'CONCURRENCY_LIMIT'
      | 'POOLED_WALLET_NOT_ENABLED',
  ) {
    super(`Plan entitlement denied: ${code}`);
    this.name = 'PlanEntitlementError';
  }
}

export interface TaskEntitlementRequest {
  modelId: string;
  modelPlanAccess?: string[];
  mode: BillingMode;
  requestedCredits: string;
  activeJobs: number;
  activeSeats?: number;
}

export class PlanCatalog {
  private readonly plans: Map<string, Plan>;

  constructor(plans: Plan[]) {
    this.plans = new Map(plans.map((plan) => [plan.id, PlanSchema.parse(plan)]));
  }

  list(): Plan[] {
    return [...this.plans.values()].map((plan) => ({
      ...plan,
      allowedModelIds: [...plan.allowedModelIds],
      allowedModes: [...plan.allowedModes],
    }));
  }

  get(planId: string): Plan {
    const normalizedId = this.plans.has(planId)
      ? planId
      : planId === 'STUDENT' || planId === 'BUILDER'
        ? this.plans.has('BASIC')
          ? 'BASIC'
          : planId === 'STUDENT' && this.plans.has('BUILDER')
            ? 'BUILDER'
            : planId
        : planId;
    const plan = this.plans.get(normalizedId);
    if (!plan) throw new Error(`Unknown plan: ${planId}`);
    return plan;
  }

  assertTaskAllowed(planId: string, request: TaskEntitlementRequest): void {
    const plan = this.get(planId);
    const modelAllowed = request.modelPlanAccess
      ? request.modelPlanAccess.includes(planId) || request.modelPlanAccess.includes(plan.id)
      : plan.allowedModelIds.includes('*') || plan.allowedModelIds.includes(request.modelId);
    if (!plan.enabled || !modelAllowed) throw new PlanEntitlementError('MODEL_NOT_ALLOWED');
    if (!plan.allowedModes.includes(request.mode))
      throw new PlanEntitlementError('MODE_NOT_ALLOWED');
    if (compareCredits(request.requestedCredits, plan.maxTaskBudgetCredits) > 0)
      throw new PlanEntitlementError('TASK_BUDGET_EXCEEDED');
    const activeSeats = Math.max(1, request.activeSeats ?? 1);
    const seatConcurrency = plan.activeJobsPerSeat * activeSeats;
    const concurrencyLimit = Math.min(plan.maxConcurrentJobs, seatConcurrency);
    if (request.activeJobs >= concurrencyLimit) throw new PlanEntitlementError('CONCURRENCY_LIMIT');
  }
}

export function createDefaultPlanCatalog(): PlanCatalog {
  const allModels = ['*'];
  return new PlanCatalog([
    PlanSchema.parse({
      id: 'FREE',
      displayName: 'Free',
      monthlyPriceInr: '0',
      monthlyPriceUsd: '0',
      monthlyCredits: '25',
      allowedModelIds: allModels,
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '25',
      maxConcurrentJobs: 1,
      mcpLimit: 0,
      pluginLimit: 0,
      premiumModeAccess: false,
      maxContextWindow: 128_000,
      priority: 'standard',
      enabled: true,
      seats: 1,
      activeJobsPerSeat: 1,
      pooledCredits: false,
      crossPersonRooms: false,
      rolloverCycles: 1,
      topUpEnabled: false,
    }),
    PlanSchema.parse({
      id: 'BASIC',
      displayName: 'Basic',
      monthlyPriceInr: '549',
      monthlyPriceUsd: '6',
      monthlyCredits: '300',
      allowedModelIds: allModels,
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '300',
      maxConcurrentJobs: 3,
      mcpLimit: 5,
      pluginLimit: 5,
      premiumModeAccess: true,
      maxContextWindow: 128_000,
      priority: 'priority',
      enabled: true,
      seats: 1,
      activeJobsPerSeat: 3,
      pooledCredits: false,
      crossPersonRooms: false,
      rolloverCycles: 1,
      topUpEnabled: true,
    }),
    PlanSchema.parse({
      id: 'PRO',
      displayName: 'Pro',
      monthlyPriceInr: '999',
      monthlyPriceUsd: '11',
      monthlyCredits: '600',
      allowedModelIds: allModels,
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '600',
      maxConcurrentJobs: 5,
      mcpLimit: 20,
      pluginLimit: 20,
      premiumModeAccess: true,
      maxContextWindow: 256_000,
      priority: 'priority',
      enabled: true,
      seats: 1,
      activeJobsPerSeat: 5,
      pooledCredits: false,
      crossPersonRooms: false,
      rolloverCycles: 1,
      topUpEnabled: true,
    }),
    PlanSchema.parse({
      id: 'MAX',
      displayName: 'Max',
      monthlyPriceInr: '1899',
      monthlyPriceUsd: '21',
      monthlyCredits: '1200',
      allowedModelIds: allModels,
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '1200',
      maxConcurrentJobs: 10,
      mcpLimit: 100,
      pluginLimit: 100,
      premiumModeAccess: true,
      maxContextWindow: 1_000_000,
      priority: 'highest',
      enabled: true,
      seats: 1,
      activeJobsPerSeat: 10,
      pooledCredits: false,
      crossPersonRooms: false,
      rolloverCycles: 1,
      topUpEnabled: true,
    }),
    PlanSchema.parse({
      id: 'TEAM',
      displayName: 'Team',
      monthlyPriceInr: '9499',
      monthlyPriceUsd: '105',
      monthlyCredits: '6000',
      allowedModelIds: allModels,
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '1200',
      maxConcurrentJobs: 50,
      mcpLimit: 100,
      pluginLimit: 100,
      premiumModeAccess: true,
      maxContextWindow: 1_000_000,
      priority: 'highest',
      enabled: true,
      seats: 5,
      activeJobsPerSeat: 10,
      pooledCredits: true,
      crossPersonRooms: true,
      rolloverCycles: 1,
      topUpEnabled: true,
    }),
    PlanSchema.parse({
      id: 'BUSINESS',
      displayName: 'Business',
      monthlyPriceInr: '18999',
      monthlyPriceUsd: '209',
      monthlyCredits: '12000',
      allowedModelIds: allModels,
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '2400',
      maxConcurrentJobs: 100,
      mcpLimit: 100,
      pluginLimit: 100,
      premiumModeAccess: true,
      maxContextWindow: 1_000_000,
      priority: 'highest',
      enabled: true,
      seats: 10,
      activeJobsPerSeat: 10,
      pooledCredits: true,
      crossPersonRooms: true,
      rolloverCycles: 1,
      topUpEnabled: true,
    }),
  ]);
}
