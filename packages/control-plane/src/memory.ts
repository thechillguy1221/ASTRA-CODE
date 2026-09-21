import { ControlPlaneError } from './errors.js';
import type {
  AuditEventInput,
  ControlPlaneModelSnapshot,
  ControlPlanePlanSnapshot,
  InvalidationMessage,
  ModelWriteInput,
  PlanWriteInput,
} from './contracts.js';
import type { ControlPlaneRepository, ControlPlaneTransaction, InvalidationBus } from './ports.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface MemoryState {
  plans: Map<string, { current: ControlPlanePlanSnapshot; history: ControlPlanePlanSnapshot[] }>;
  models: Map<string, { current: ControlPlaneModelSnapshot; history: ControlPlaneModelSnapshot[] }>;
  audit: AuditEventInput[];
}

function emptyState(): MemoryState {
  return { plans: new Map(), models: new Map(), audit: [] };
}

class MemoryTransaction implements ControlPlaneTransaction {
  constructor(private readonly state: MemoryState) {}

  async putPlan(input: PlanWriteInput): Promise<ControlPlanePlanSnapshot> {
    const existing = this.state.plans.get(input.plan.id);
    const currentVersion = existing?.current.version ?? 0;
    if (currentVersion !== input.expectedVersion || input.plan.version !== currentVersion + 1)
      throw new ControlPlaneError(
        'CONTROL_PLANE_VERSION_CONFLICT',
        `Plan ${input.plan.id} is at version ${currentVersion}`,
      );
    const next = clone(input.plan);
    this.state.plans.set(input.plan.id, {
      current: next,
      history: [next, ...(existing?.history ?? [])],
    });
    await this.appendAudit(input.audit);
    return clone(next);
  }

  async putModel(input: ModelWriteInput): Promise<ControlPlaneModelSnapshot> {
    const existing = this.state.models.get(input.model.modelId);
    const currentVersion = existing?.current.version ?? 0;
    if (currentVersion !== input.expectedVersion || input.model.version !== currentVersion + 1)
      throw new ControlPlaneError(
        'CONTROL_PLANE_VERSION_CONFLICT',
        `Model ${input.model.modelId} is at version ${currentVersion}`,
      );
    const next = clone(input.model);
    this.state.models.set(input.model.modelId, {
      current: next,
      history: [next, ...(existing?.history ?? [])],
    });
    await this.appendAudit(input.audit);
    return clone(next);
  }

  async appendAudit(event: AuditEventInput): Promise<void> {
    this.state.audit.push(clone(event));
  }
}

export class InMemoryControlPlaneRepository implements ControlPlaneRepository {
  private state: MemoryState = emptyState();
  public failReads = false;

  constructor(input: { plans?: ControlPlanePlanSnapshot[]; models?: ControlPlaneModelSnapshot[] } = {}) {
    for (const plan of input.plans ?? []) this.seedPlan(plan);
    for (const model of input.models ?? []) this.seedModel(model);
  }

  async listPlans(): Promise<ControlPlanePlanSnapshot[]> {
    this.assertReadable();
    return [...this.state.plans.values()]
      .sort((left, right) => left.current.id.localeCompare(right.current.id))
      .map((entry) => clone(entry.current));
  }

  async getPlan(planId: string): Promise<ControlPlanePlanSnapshot | undefined> {
    this.assertReadable();
    const entry = this.state.plans.get(planId);
    return entry ? clone(entry.current) : undefined;
  }

  async listPlanVersions(planId: string): Promise<ControlPlanePlanSnapshot[]> {
    this.assertReadable();
    return (this.state.plans.get(planId)?.history ?? []).map((entry) => clone(entry));
  }

  async listModels(): Promise<ControlPlaneModelSnapshot[]> {
    this.assertReadable();
    return [...this.state.models.values()]
      .sort((left, right) => left.current.modelId.localeCompare(right.current.modelId))
      .map((entry) => clone(entry.current));
  }

  async getModel(modelId: string): Promise<ControlPlaneModelSnapshot | undefined> {
    this.assertReadable();
    const entry = this.state.models.get(modelId);
    return entry ? clone(entry.current) : undefined;
  }

  async listAudit(input: { limit?: number; offset?: number } = {}): Promise<AuditEventInput[]> {
    this.assertReadable();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
    const offset = Math.max(input.offset ?? 0, 0);
    return this.state.audit
      .slice()
      .reverse()
      .slice(offset, offset + limit)
      .map((entry) => clone(entry));
  }

  async transaction<T>(operation: (transaction: ControlPlaneTransaction) => Promise<T>): Promise<T> {
    const working = cloneState(this.state);
    const result = await operation(new MemoryTransaction(working));
    this.state = working;
    return result;
  }

  async seedPlan(plan: ControlPlanePlanSnapshot): Promise<void> {
    this.state.plans.set(plan.id, { current: clone(plan), history: [clone(plan)] });
  }

  async seedModel(model: ControlPlaneModelSnapshot): Promise<void> {
    this.state.models.set(model.modelId, { current: clone(model), history: [clone(model)] });
  }

  private assertReadable(): void {
    if (this.failReads) throw new Error('control plane read unavailable');
  }
}

function cloneState(state: MemoryState): MemoryState {
  const next = emptyState();
  for (const [id, entry] of state.plans) next.plans.set(id, clone(entry));
  for (const [id, entry] of state.models) next.models.set(id, clone(entry));
  next.audit = clone(state.audit);
  return next;
}

export class InMemoryAuditStore {
  private readonly entries: AuditEventInput[] = [];

  async append(entry: AuditEventInput): Promise<void> {
    this.entries.push(clone(entry));
  }

  async list(): Promise<AuditEventInput[]> {
    return this.entries.slice().reverse().map((entry) => clone(entry));
  }
}

export class InMemoryInvalidationBus implements InvalidationBus {
  private readonly listeners = new Set<(message: InvalidationMessage) => void>();

  async publish(message: InvalidationMessage): Promise<void> {
    for (const listener of this.listeners) listener(clone(message));
  }

  subscribe(listener: (message: InvalidationMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
