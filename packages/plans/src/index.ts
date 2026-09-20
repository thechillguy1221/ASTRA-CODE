import { PlanSchema, type BillingMode, type Plan } from '@lyntar/contracts';

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
      'MODEL_NOT_ALLOWED' | 'MODE_NOT_ALLOWED' | 'TASK_BUDGET_EXCEEDED' | 'CONCURRENCY_LIMIT',
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
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Unknown plan: ${planId}`);
    return plan;
  }

  assertTaskAllowed(planId: string, request: TaskEntitlementRequest): void {
    const plan = this.get(planId);
    const modelAllowed = request.modelPlanAccess
      ? request.modelPlanAccess.includes(planId)
      : plan.allowedModelIds.includes(request.modelId);
    if (!plan.enabled || !modelAllowed) throw new PlanEntitlementError('MODEL_NOT_ALLOWED');
    if (!plan.allowedModes.includes(request.mode))
      throw new PlanEntitlementError('MODE_NOT_ALLOWED');
    if (compareCredits(request.requestedCredits, plan.maxTaskBudgetCredits) > 0)
      throw new PlanEntitlementError('TASK_BUDGET_EXCEEDED');
    if (request.activeJobs >= plan.maxConcurrentJobs)
      throw new PlanEntitlementError('CONCURRENCY_LIMIT');
  }
}

export function createDefaultPlanCatalog(): PlanCatalog {
  const common = {
    allowedModelIds: ['approved-core'],
    maxContextWindow: 128_000,
    enabled: true,
  } as const;
  return new PlanCatalog([
    PlanSchema.parse({
      id: 'FREE',
      displayName: 'Free',
      monthlyPriceInr: '0',
      monthlyCredits: '50',
      allowedModelIds: common.allowedModelIds,
      allowedModes: ['BUILD', 'LEARN'],
      maxTaskBudgetCredits: '25',
      maxConcurrentJobs: 1,
      mcpLimit: 0,
      pluginLimit: 0,
      premiumModeAccess: false,
      maxContextWindow: common.maxContextWindow,
      priority: 'standard',
      enabled: common.enabled,
    }),
    PlanSchema.parse({
      id: 'STUDENT',
      displayName: 'Student',
      monthlyPriceInr: '149',
      monthlyCredits: '500',
      allowedModelIds: ['approved-core', 'frontier'],
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '100',
      maxConcurrentJobs: 2,
      mcpLimit: 5,
      pluginLimit: 5,
      premiumModeAccess: true,
      maxContextWindow: common.maxContextWindow,
      priority: 'priority',
      enabled: common.enabled,
    }),
    PlanSchema.parse({
      id: 'PRO',
      displayName: 'Pro',
      monthlyPriceInr: '299',
      monthlyCredits: '1200',
      allowedModelIds: ['approved-core', 'frontier'],
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '250',
      maxConcurrentJobs: 4,
      mcpLimit: 20,
      pluginLimit: 20,
      premiumModeAccess: true,
      maxContextWindow: 256_000,
      priority: 'priority',
      enabled: common.enabled,
    }),
    PlanSchema.parse({
      id: 'MAX',
      displayName: 'Max',
      monthlyPriceInr: '599',
      monthlyCredits: '2500',
      allowedModelIds: ['approved-core', 'frontier'],
      allowedModes: ['BUILD', 'LEARN', 'VIVA', 'HACKATHON'],
      maxTaskBudgetCredits: '500',
      maxConcurrentJobs: 8,
      mcpLimit: 100,
      pluginLimit: 100,
      premiumModeAccess: true,
      maxContextWindow: 1_000_000,
      priority: 'highest',
      enabled: common.enabled,
    }),
  ]);
}
