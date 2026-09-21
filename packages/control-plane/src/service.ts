import {
  AuditEventInputSchema,
  ControlPlaneModelSnapshotSchema,
  ControlPlanePlanSnapshotSchema,
  MutationMetadataSchema,
  type AdminPermission,
  type AuditContext,
  type AuditEventInput,
  type ControlPlaneModelSnapshot,
  type ControlPlanePlanSnapshot,
  type InvalidationMessage,
  type LimitValue,
  type MutationMetadata,
} from './contracts.js';
import { redactAuditEvent } from './audit.js';
import { ControlPlaneError } from './errors.js';
import type { ControlPlaneRepository, InvalidationBus } from './ports.js';
import {
  hasAdminPermission,
  resolveAdminPermissions,
  type ControlPlaneAdminRole,
} from './permissions.js';

export interface ControlPlaneActor {
  userId: string;
  role: ControlPlaneAdminRole;
  permissions: readonly AdminPermission[];
}

export interface ControlPlaneServiceOptions {
  repository: ControlPlaneRepository;
  invalidationBus: InvalidationBus;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface ControlPlaneWriteRequest {
  metadata: MutationMetadata;
  actor: ControlPlaneActor;
  context: AuditContext;
}

export interface ModelAccessRequest {
  planId: string;
  modelId: string;
  region?: string;
}

export interface ModelAccessDecision {
  allowed: boolean;
  reason:
    | 'ALLOWED'
    | 'PLAN_NOT_FOUND'
    | 'MODEL_NOT_FOUND'
    | 'PLAN_DISABLED'
    | 'MODEL_UNAVAILABLE'
    | 'MODEL_NOT_ALLOWED'
    | 'REGION_UNAVAILABLE'
    | 'CONTROL_PLANE_UNAVAILABLE';
  model?: ControlPlaneModelSnapshot;
  plan?: ControlPlanePlanSnapshot;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ControlPlaneService {
  private readonly repository: ControlPlaneRepository;
  private readonly invalidationBus: InvalidationBus;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly plans = new Map<string, CacheEntry<ControlPlanePlanSnapshot>>();
  private readonly models = new Map<string, CacheEntry<ControlPlaneModelSnapshot>>();
  private readonly unsubscribe: () => void;

  constructor(options: ControlPlaneServiceOptions) {
    this.repository = options.repository;
    this.invalidationBus = options.invalidationBus;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.unsubscribe = this.invalidationBus.subscribe((message) => this.invalidate(message));
  }

  async listPlans(): Promise<ControlPlanePlanSnapshot[]> {
    return this.repository.listPlans();
  }

  async getPlan(planId: string): Promise<ControlPlanePlanSnapshot | undefined> {
    const cached = this.plans.get(planId);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    try {
      const value = await this.repository.getPlan(planId);
      if (value)
        this.plans.set(planId, {
          value: structuredClone(value),
          expiresAt: this.now() + this.cacheTtlMs,
        });
      else this.plans.delete(planId);
      return value ? structuredClone(value) : undefined;
    } catch (error) {
      throw new ControlPlaneError(
        'CONTROL_PLANE_UNAVAILABLE',
        error instanceof Error ? error.message : 'Control-plane read failed',
      );
    }
  }

  async listPlanVersions(planId: string): Promise<ControlPlanePlanSnapshot[]> {
    return this.repository.listPlanVersions(planId);
  }

  async listModels(): Promise<ControlPlaneModelSnapshot[]> {
    return this.repository.listModels();
  }

  async getModel(modelId: string): Promise<ControlPlaneModelSnapshot | undefined> {
    const cached = this.models.get(modelId);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    try {
      const value = await this.repository.getModel(modelId);
      if (value)
        this.models.set(modelId, {
          value: structuredClone(value),
          expiresAt: this.now() + this.cacheTtlMs,
        });
      else this.models.delete(modelId);
      return value ? structuredClone(value) : undefined;
    } catch (error) {
      throw new ControlPlaneError(
        'CONTROL_PLANE_UNAVAILABLE',
        error instanceof Error ? error.message : 'Control-plane read failed',
      );
    }
  }

  async listAudit(input?: { limit?: number; offset?: number }): Promise<AuditEventInput[]> {
    return this.repository.listAudit(input);
  }

  async appendAudit(
    input: ControlPlaneWriteRequest & {
      permission: AdminPermission;
      action: string;
      targetType: string;
      targetId: string;
      before?: unknown;
      after?: unknown;
    },
  ): Promise<void> {
    this.assertPermission(input.actor, input.permission);
    const metadata = MutationMetadataSchema.parse(input.metadata);
    const event = redactAuditEvent(
      AuditEventInputSchema.parse({
        actor: input.actor,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before,
        after: input.after,
        reason: metadata.reason,
        requestId: metadata.requestId,
        context: input.context,
        createdAt: new Date(this.now()).toISOString(),
      }),
    );
    await this.repository.transaction((transaction) => transaction.appendAudit(event));
  }

  async updatePlan(input: {
    plan: ControlPlanePlanSnapshot;
    metadata: MutationMetadata;
    actor: ControlPlaneActor;
    context: AuditContext;
  }): Promise<ControlPlanePlanSnapshot> {
    ControlPlanePlanSnapshotSchema.parse(input.plan);
    const metadata = MutationMetadataSchema.parse(input.metadata);
    this.assertPermission(input.actor, 'admin.plans');
    const before = await this.repository.getPlan(input.plan.id);
    const audit = this.createAudit('PLAN_UPDATED', input.plan.id, before, input.plan, input);
    const updated = await this.repository.transaction((transaction) =>
      transaction.putPlan({ plan: input.plan, expectedVersion: metadata.expectedVersion, audit }),
    );
    await this.publishInvalidation({
      domain: 'plans',
      resourceId: updated.id,
      version: updated.version,
    });
    return updated;
  }

  async updateModel(input: {
    model: ControlPlaneModelSnapshot;
    metadata: MutationMetadata;
    actor: ControlPlaneActor;
    context: AuditContext;
  }): Promise<ControlPlaneModelSnapshot> {
    ControlPlaneModelSnapshotSchema.parse(input.model);
    const metadata = MutationMetadataSchema.parse(input.metadata);
    this.assertPermission(input.actor, 'admin.models');
    const before = await this.repository.getModel(input.model.modelId);
    const audit = this.createAudit(
      'MODEL_UPDATED',
      input.model.modelId,
      before,
      input.model,
      input,
    );
    const updated = await this.repository.transaction((transaction) =>
      transaction.putModel({
        model: input.model,
        expectedVersion: metadata.expectedVersion,
        audit,
      }),
    );
    await this.publishInvalidation({
      domain: 'models',
      resourceId: updated.modelId,
      version: updated.version,
    });
    return updated;
  }

  async evaluateModelAccess(input: ModelAccessRequest): Promise<ModelAccessDecision> {
    try {
      const [plan, model] = await Promise.all([
        this.getPlan(input.planId),
        this.getModel(input.modelId),
      ]);
      if (!plan) return { allowed: false, reason: 'PLAN_NOT_FOUND' };
      if (!model) return { allowed: false, reason: 'MODEL_NOT_FOUND', plan };
      if (!plan.enabled || plan.status !== 'ACTIVE')
        return { allowed: false, reason: 'PLAN_DISABLED', plan, model };
      if (!model.enabled || model.visible === false || model.status !== 'AVAILABLE')
        return { allowed: false, reason: 'MODEL_UNAVAILABLE', plan, model };
      if (
        input.region &&
        !model.regionAvailability.includes('GLOBAL') &&
        !model.regionAvailability.includes(input.region)
      )
        return { allowed: false, reason: 'REGION_UNAVAILABLE', plan, model };
      if (!plan.allowedModelIds.includes('*') && !plan.allowedModelIds.includes(model.modelId))
        return { allowed: false, reason: 'MODEL_NOT_ALLOWED', plan, model };
      if (
        model.planAccess?.length &&
        !model.planAccess.includes('*') &&
        !model.planAccess.includes(plan.id)
      )
        return { allowed: false, reason: 'MODEL_NOT_ALLOWED', plan, model };
      return { allowed: true, reason: 'ALLOWED', plan, model };
    } catch (error) {
      if (error instanceof ControlPlaneError && error.code === 'CONTROL_PLANE_UNAVAILABLE')
        return { allowed: false, reason: 'CONTROL_PLANE_UNAVAILABLE' };
      throw error;
    }
  }

  async evaluateEntitlement(planId: string, entitlement: string): Promise<boolean> {
    const plan = await this.getPlan(planId);
    return plan?.entitlements[entitlement] === true;
  }

  async getLimit(planId: string, key: string): Promise<LimitValue | undefined> {
    const plan = await this.getPlan(planId);
    return plan?.limits[key];
  }

  async assertTaskAllowed(input: {
    planId: string;
    modelId: string;
    mode: 'BUILD' | 'LEARN' | 'VIVA' | 'HACKATHON';
    requestedCredits: string;
    activeJobs: number;
    activeSeats?: number;
  }): Promise<void> {
    const plan = await this.getPlan(input.planId);
    if (!plan || !plan.enabled || plan.status !== 'ACTIVE')
      throw new ControlPlaneError('CONTROL_PLANE_POLICY_DENIED', 'Plan is not active');
    if (!plan.allowedModes.includes(input.mode))
      throw new ControlPlaneError(
        'CONTROL_PLANE_POLICY_DENIED',
        'Mode is not enabled for the plan',
      );
    const access = await this.evaluateModelAccess({ planId: input.planId, modelId: input.modelId });
    if (!access.allowed)
      throw new ControlPlaneError(
        'CONTROL_PLANE_POLICY_DENIED',
        `Model policy denied: ${access.reason}`,
      );
    if (decimalCredits(input.requestedCredits) > decimalCredits(plan.maxTaskBudgetCredits))
      throw new ControlPlaneError('CONTROL_PLANE_POLICY_DENIED', 'Task credit budget exceeded');
    const activeSeats = Math.max(1, input.activeSeats ?? 1);
    const concurrencyLimit = Math.min(plan.maxConcurrentJobs, plan.activeJobsPerSeat * activeSeats);
    if (input.activeJobs >= concurrencyLimit)
      throw new ControlPlaneError('CONTROL_PLANE_POLICY_DENIED', 'Concurrency limit exceeded');
  }

  close(): void {
    this.unsubscribe();
  }

  private invalidate(message: InvalidationMessage): void {
    if (message.domain === 'plans') this.plans.delete(message.resourceId);
    if (message.domain === 'models') this.models.delete(message.resourceId);
  }

  private async publishInvalidation(message: InvalidationMessage): Promise<void> {
    this.invalidate(message);
    try {
      await this.invalidationBus.publish(message);
    } catch {
      this.invalidate(message);
    }
  }

  private createAudit(
    action: string,
    targetId: string,
    before: unknown,
    after: unknown,
    input: ControlPlaneWriteRequest,
  ): AuditEventInput {
    return redactAuditEvent(
      AuditEventInputSchema.parse({
        actor: input.actor,
        action,
        targetType: action.startsWith('PLAN') ? 'plan' : 'model',
        targetId,
        before,
        after,
        reason: input.metadata.reason,
        requestId: input.metadata.requestId,
        context: input.context,
        createdAt: new Date(this.now()).toISOString(),
      }),
    );
  }

  private assertPermission(actor: ControlPlaneActor, permission: AdminPermission): void {
    const permissions = actor.permissions.length
      ? actor.permissions
      : resolveAdminPermissions(actor.role);
    if (!hasAdminPermission(permissions, permission))
      throw new ControlPlaneError('CONTROL_PLANE_FORBIDDEN', `Missing permission ${permission}`);
  }
}

function decimalCredits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole ?? '0') * 10_000_000n + BigInt((fraction + '0000000').slice(0, 7));
}
