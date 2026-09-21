import { randomUUID } from 'node:crypto';
import {
  AgentDefinitionSchema,
  AutomationSchema,
  CheckpointSchema,
  HookSchema,
  MemoryEntrySchema,
  ModelRouteSchema,
  PlatformEventSchema,
  PluginManifestSchema,
  ReviewFindingSchema,
  SkillManifestSchema,
  SpecSchema,
  SpecTaskSchema,
  SteeringDocumentSchema,
  VerificationEvidenceSchema,
  type AgentDefinition,
  type Automation,
  type Checkpoint,
  type Hook,
  type MemoryEntry,
  type ModelRoute,
  type PlatformEntityKind,
  type PlatformEvent,
  type PlatformRecord,
  type PluginManifest,
  type ReviewFinding,
  type SkillManifest,
  type Spec,
  type SpecDesign,
  type SpecRequirements,
  type SpecTask,
  type SteeringDocument,
  type VerificationEvidence,
} from './contracts.js';
import { platformEvent, platformRecord, type PlatformRecordStore } from './store.js';
import { ModelRouter, type ModelRouteRequest } from './routing.js';

export interface PlatformServiceOptions {
  store: PlatformRecordStore;
  now?: () => string;
}
export interface HookDecision {
  hookId: string;
  decision: 'ALLOW' | 'ASK' | 'DENY';
  reason: string;
}
export interface PlatformTaskRunResult {
  taskId: string;
  status: SpecTask['status'];
  error: string | null;
}

const emptyDesign = (): SpecDesign => ({
  architecture: '',
  components: [],
  dataModel: [],
  apiChanges: [],
  flows: [],
  authorization: [],
  security: [],
  failureModes: [],
  migrations: [],
  observability: [],
  testing: [],
  rollback: [],
});
const emptyRequirements = (objective: string): SpecRequirements => ({
  objective,
  userStories: [],
  functional: [],
  nonFunctional: [],
  security: [],
  compatibility: [],
  acceptanceCriteria: [],
  nonGoals: [],
});
function payload<T>(record: PlatformRecord, parser: { parse(value: unknown): T }): T {
  return parser.parse(record.payload);
}
function redact(value: string): string {
  return value.replace(
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]\s*)\S+/gi,
    '$1[REDACTED]',
  );
}
function dependenciesSatisfied(task: SpecTask, tasks: SpecTask[]): boolean {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  return task.dependencies.every((id) => byId.get(id)?.status === 'SUCCEEDED');
}
function assertAcyclic(tasks: SpecTask[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Task dependency cycle detected at ${id}`);
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new Error(`Task dependency does not exist: ${id}`);
    visiting.add(id);
    task.dependencies.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach((task) => visit(task.id));
}

export class PlatformOrchestrationService {
  private readonly store: PlatformRecordStore;
  private readonly now: () => string;
  constructor(options: PlatformServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createSpec(input: {
    ownerId: string;
    title: string;
    slug: string;
    repositoryId?: string | null;
    objective: string;
    requirements?: Partial<SpecRequirements>;
    design?: Partial<SpecDesign>;
    correlationId?: string;
  }): Promise<Spec> {
    const now = this.now();
    const spec = SpecSchema.parse({
      id: `spec_${randomUUID()}`,
      slug: input.slug,
      title: input.title,
      ownerId: input.ownerId,
      repositoryId: input.repositoryId ?? null,
      status: 'DRAFT',
      version: 1,
      requirements: { ...emptyRequirements(input.objective), ...input.requirements },
      design: { ...emptyDesign(), ...input.design },
      taskIds: [],
      dependencyIds: [],
      executionState: 'NOT_STARTED',
      verificationState: 'NOT_RUN',
      createdAt: now,
      updatedAt: now,
    });
    await this.store.put(platformRecord('SPEC', spec.id, spec.ownerId, spec, now), null);
    await this.emit('spec.created', spec.id, input.ownerId, input.correlationId, {
      title: spec.title,
    });
    return spec;
  }

  async getSpec(specId: string): Promise<Spec> {
    return payload(await this.require('SPEC', specId), SpecSchema);
  }

  async updateSpec(input: {
    specId: string;
    actorId: string;
    expectedVersion: number;
    requirements?: SpecRequirements;
    design?: SpecDesign;
    status?: Spec['status'];
    correlationId?: string;
  }): Promise<Spec> {
    const record = await this.require('SPEC', input.specId);
    const current = await this.requireOwnedSpec(input.specId, input.actorId);
    const next = SpecSchema.parse({
      ...current,
      ...(input.requirements ? { requirements: input.requirements } : {}),
      ...(input.design ? { design: input.design } : {}),
      ...(input.status ? { status: input.status } : {}),
      version: current.version + 1,
      updatedAt: this.now(),
    });
    await this.store.put(
      { ...record, version: record.version + 1, payload: next, updatedAt: next.updatedAt },
      input.expectedVersion,
    );
    await this.emit('spec.updated', next.id, input.actorId, input.correlationId, {
      version: next.version,
    });
    return next;
  }

  async addTasks(input: {
    specId: string;
    actorId: string;
    tasks: Array<
      Omit<
        SpecTask,
        | 'specId'
        | 'status'
        | 'verificationStatus'
        | 'assignedAgentId'
        | 'worktreeId'
        | 'leaseId'
        | 'leaseExpiresAt'
        | 'createdAt'
        | 'updatedAt'
      >
    >;
    correlationId?: string;
  }): Promise<SpecTask[]> {
    const specRecord = await this.require('SPEC', input.specId);
    const spec = await this.requireOwnedSpec(input.specId, input.actorId);
    const now = this.now();
    const existing = await this.listTasks(input.specId);
    const created = input.tasks.map((task) =>
      SpecTaskSchema.parse({
        ...task,
        specId: input.specId,
        status: 'PENDING',
        verificationStatus: 'NOT_RUN',
        assignedAgentId: null,
        worktreeId: null,
        leaseId: null,
        leaseExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    assertAcyclic([...existing, ...created]);
    const nextSpec = SpecSchema.parse({
      ...spec,
      taskIds: [...spec.taskIds, ...created.map((task) => task.id)],
      version: spec.version + 1,
      updatedAt: now,
    });
    await this.store.transaction(async (transaction) => {
      for (const task of created)
        await transaction.put(platformRecord('TASK', task.id, spec.ownerId, task, now), null);
      await transaction.put(
        { ...specRecord, version: specRecord.version + 1, payload: nextSpec, updatedAt: now },
        specRecord.version,
      );
      await transaction.appendEvent(
        platformEvent(
          'task.graph.updated',
          input.specId,
          input.actorId,
          input.correlationId ?? randomUUID(),
          { added: created.map((task) => task.id) },
          now,
        ),
      );
    });
    return created;
  }

  async listTasks(specId: string): Promise<SpecTask[]> {
    return (await this.store.list('TASK'))
      .map((record) => payload(record, SpecTaskSchema))
      .filter((task) => task.specId === specId);
  }

  async readyTasks(specId: string): Promise<SpecTask[]> {
    const tasks = await this.listTasks(specId);
    assertAcyclic(tasks);
    const ready: SpecTask[] = [];
    for (const task of tasks)
      if (task.status === 'PENDING' && dependenciesSatisfied(task, tasks)) {
        const record = await this.require('TASK', task.id);
        const updated = SpecTaskSchema.parse({ ...task, status: 'READY', updatedAt: this.now() });
        await this.store.put(
          {
            ...record,
            version: record.version + 1,
            payload: updated,
            updatedAt: updated.updatedAt,
          },
          record.version,
        );
        ready.push(updated);
      } else if (task.status === 'READY') ready.push(task);
    return ready;
  }

  async claimTask(input: {
    taskId: string;
    agentId: string;
    leaseMs: number;
    correlationId?: string;
  }): Promise<SpecTask> {
    const record = await this.require('TASK', input.taskId);
    const task = payload(record, SpecTaskSchema);
    if (!['READY', 'PENDING'].includes(task.status))
      throw new Error(`Task is not claimable: ${task.status}`);
    if (!dependenciesSatisfied(task, await this.listTasks(task.specId)))
      throw new Error('Task dependencies are not complete');
    if (task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) > Date.now())
      throw new Error('Task already has an active lease');
    const updated = SpecTaskSchema.parse({
      ...task,
      status: 'RUNNING',
      assignedAgentId: input.agentId,
      leaseId: `lease_${randomUUID()}`,
      leaseExpiresAt: new Date(Date.now() + input.leaseMs).toISOString(),
      updatedAt: this.now(),
    });
    await this.store.put(
      { ...record, version: record.version + 1, payload: updated, updatedAt: updated.updatedAt },
      record.version,
    );
    await this.emit('agent.started', updated.id, input.agentId, input.correlationId, {
      taskId: updated.id,
    });
    return updated;
  }

  async completeTask(input: {
    taskId: string;
    agentId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
    error?: string | null;
    correlationId?: string;
  }): Promise<SpecTask> {
    const record = await this.require('TASK', input.taskId);
    const task = payload(record, SpecTaskSchema);
    if (task.assignedAgentId !== input.agentId) throw new Error('Task lease owner mismatch');
    const updated = SpecTaskSchema.parse({
      ...task,
      status: input.status,
      verificationStatus: input.status === 'SUCCEEDED' ? 'RUNNING' : 'BLOCKED',
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: this.now(),
    });
    await this.store.put(
      {
        ...record,
        version: record.version + 1,
        payload: updated,
        status: input.status,
        updatedAt: updated.updatedAt,
      },
      record.version,
    );
    await this.emit('agent.finished', updated.id, input.agentId, input.correlationId, {
      status: updated.status,
      error: input.error ?? null,
    });
    return updated;
  }

  async runReadyTasks(
    input: { specId: string; maxParallel: number; correlationId?: string },
    executor: (task: SpecTask) => Promise<void>,
  ): Promise<PlatformTaskRunResult[]> {
    const ready = (await this.readyTasks(input.specId)).slice(0, Math.max(1, input.maxParallel));
    return Promise.all(
      ready.map(async (candidate) => {
        const agentId =
          candidate.assignedAgentId ?? `agent_${candidate.ownerAgentRole.toLowerCase()}`;
        try {
          const task = await this.claimTask({
            taskId: candidate.id,
            agentId,
            leaseMs: candidate.budget.maxWallTimeMs,
            ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          });
          await executor(task);
          await this.completeTask({
            taskId: task.id,
            agentId,
            status: 'SUCCEEDED',
            ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          });
          return { taskId: task.id, status: 'SUCCEEDED' as const, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Task execution failed';
          try {
            const current = await this.require('TASK', candidate.id);
            const task = payload(current, SpecTaskSchema);
            if (task.assignedAgentId === agentId)
              await this.completeTask({
                taskId: candidate.id,
                agentId,
                status: 'FAILED',
                error: message,
                ...(input.correlationId ? { correlationId: input.correlationId } : {}),
              });
          } catch {
            /* preserve original failure */
          }
          return { taskId: candidate.id, status: 'FAILED' as const, error: message };
        }
      }),
    );
  }

  async createCheckpoint(
    input: Omit<Checkpoint, 'id' | 'createdAt'> & { actorId: string; correlationId?: string },
  ): Promise<Checkpoint> {
    await this.requireOwnedSpec(input.specId, input.actorId);
    const checkpoint = CheckpointSchema.parse({
      ...input,
      id: `checkpoint_${randomUUID()}`,
      createdAt: this.now(),
    });
    await this.store.put(
      platformRecord('CHECKPOINT', checkpoint.id, input.actorId, checkpoint, checkpoint.createdAt),
      null,
    );
    await this.emit('checkpoint.created', checkpoint.id, input.actorId, input.correlationId, {
      specId: checkpoint.specId,
      taskId: checkpoint.taskId,
    });
    return checkpoint;
  }
  async recordReview(
    input: Omit<ReviewFinding, 'id' | 'createdAt' | 'resolvedAt'> & {
      actorId: string;
      correlationId?: string;
    },
  ): Promise<ReviewFinding> {
    await this.requireOwnedSpec(input.specId, input.actorId);
    const finding = ReviewFindingSchema.parse({
      ...input,
      id: `finding_${randomUUID()}`,
      createdAt: this.now(),
      resolvedAt: null,
    });
    await this.store.put(
      platformRecord('REVIEW', finding.id, input.actorId, finding, finding.createdAt),
      null,
    );
    await this.emit('review.finding', finding.specId, input.actorId, input.correlationId, {
      severity: finding.severity,
      status: finding.status,
      title: finding.title,
    });
    return finding;
  }
  async recordVerification(
    input: Omit<VerificationEvidence, 'id' | 'createdAt'> & { actorId: string },
  ): Promise<VerificationEvidence> {
    await this.requireOwnedSpec(input.specId, input.actorId);
    const evidence = VerificationEvidenceSchema.parse({
      ...input,
      id: `verification_${randomUUID()}`,
      createdAt: this.now(),
    });
    await this.store.put(
      platformRecord('VERIFICATION', evidence.id, input.actorId, evidence, evidence.createdAt),
      null,
    );
    await this.emit(
      'verification.completed',
      evidence.specId,
      input.actorId,
      evidence.correlationId,
      { category: evidence.category, status: evidence.status },
    );
    return evidence;
  }
  async isVerified(specId: string): Promise<boolean> {
    const reviews = (await this.store.list('REVIEW'))
      .map((record) => payload(record, ReviewFindingSchema))
      .filter((finding) => finding.specId === specId);
    const evidence = (await this.store.list('VERIFICATION'))
      .map((record) => payload(record, VerificationEvidenceSchema))
      .filter((item) => item.specId === specId);
    return (
      evidence.length > 0 &&
      evidence.every((item) => item.status === 'PASS') &&
      !reviews.some(
        (finding) => ['BLOCKER', 'HIGH'].includes(finding.severity) && finding.status === 'OPEN',
      )
    );
  }
  async saveSteering(document: SteeringDocument): Promise<SteeringDocument> {
    const parsed = SteeringDocumentSchema.parse(document);
    const current = await this.store.get('STEERING', parsed.id);
    await this.store.put(
      {
        ...platformRecord('STEERING', parsed.id, parsed.updatedBy, parsed, parsed.updatedAt),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async loadSteering(
    projectId: string,
    scopes?: SteeringDocument['scope'][],
  ): Promise<SteeringDocument[]> {
    return (await this.store.list('STEERING'))
      .map((record) => payload(record, SteeringDocumentSchema))
      .filter(
        (document) =>
          document.projectId === projectId &&
          document.enabled &&
          (!scopes || scopes.includes(document.scope)),
      );
  }
  async saveMemory(entry: MemoryEntry): Promise<MemoryEntry> {
    const parsed = MemoryEntrySchema.parse({
      ...entry,
      title: redact(entry.title),
      content: redact(entry.content),
    });
    const current = await this.store.get('MEMORY', parsed.id);
    await this.store.put(
      {
        ...platformRecord('MEMORY', parsed.id, parsed.projectId, parsed, parsed.updatedAt),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async saveHook(hook: Hook): Promise<Hook> {
    const parsed = HookSchema.parse(hook);
    const current = await this.store.get('HOOK', parsed.id);
    await this.store.put(
      {
        ...platformRecord('HOOK', parsed.id, parsed.projectId, parsed, parsed.updatedAt),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async evaluateHooks(projectId: string, event: Hook['event']): Promise<HookDecision[]> {
    return (await this.store.list('HOOK'))
      .map((record) => payload(record, HookSchema))
      .filter((hook) => hook.projectId === projectId && hook.event === event && hook.enabled)
      .map((hook) => ({
        hookId: hook.id,
        decision: hook.policy,
        reason: `${hook.name} policy for ${event}`,
      }));
  }
  async saveAutomation(automation: Automation): Promise<Automation> {
    const parsed = AutomationSchema.parse(automation);
    const current = await this.store.get('AUTOMATION', parsed.id);
    await this.store.put(
      {
        ...platformRecord('AUTOMATION', parsed.id, parsed.ownerId, parsed, parsed.updatedAt),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async saveAgent(agent: AgentDefinition): Promise<AgentDefinition> {
    const parsed = AgentDefinitionSchema.parse(agent);
    const current = await this.store.get('AGENT', parsed.id);
    const now = this.now();
    await this.store.put(
      {
        ...platformRecord('AGENT', parsed.id, parsed.id, parsed, now),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async savePlugin(plugin: PluginManifest): Promise<PluginManifest> {
    const parsed = PluginManifestSchema.parse(plugin);
    const current = await this.store.get('PLUGIN', parsed.id);
    const now = this.now();
    await this.store.put(
      {
        ...platformRecord('PLUGIN', parsed.id, parsed.id, parsed, now),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async saveSkill(skill: SkillManifest): Promise<SkillManifest> {
    const parsed = SkillManifestSchema.parse(skill);
    const current = await this.store.get('SKILL', parsed.id);
    const now = this.now();
    await this.store.put(
      {
        ...platformRecord('SKILL', parsed.id, parsed.id, parsed, now),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async saveModelRoute(route: ModelRoute): Promise<ModelRoute> {
    const parsed = ModelRouteSchema.parse(route);
    const current = await this.store.get('MODEL_ROUTE', parsed.modelId);
    const now = this.now();
    await this.store.put(
      {
        ...platformRecord('MODEL_ROUTE', parsed.modelId, parsed.modelId, parsed, now),
        ...(current ? { version: current.version + 1, createdAt: current.createdAt } : {}),
      },
      current?.version ?? null,
    );
    return parsed;
  }
  async resolveModelRoute(input: ModelRouteRequest): Promise<ReturnType<ModelRouter['resolve']>> {
    const routes = (await this.store.list('MODEL_ROUTE')).map((record) =>
      payload(record, ModelRouteSchema),
    );
    return new ModelRouter(routes).resolve(input);
  }
  async listEvents(entityId: string, limit?: number): Promise<PlatformEvent[]> {
    return (await this.store.listEvents(entityId, limit)).map((event) =>
      PlatformEventSchema.parse(event),
    );
  }
  async get(kind: PlatformEntityKind, id: string): Promise<PlatformRecord | undefined> {
    return this.store.get(kind, id);
  }
  private async require(kind: PlatformEntityKind, id: string): Promise<PlatformRecord> {
    const record = await this.store.get(kind, id);
    if (!record) throw new Error(`${kind} not found: ${id}`);
    return record;
  }
  private async requireOwnedSpec(specId: string, actorId: string): Promise<Spec> {
    const spec = await this.getSpec(specId);
    if (spec.ownerId !== actorId) throw new Error('Spec owner authorization required');
    return spec;
  }
  private async emit(
    kind: string,
    entityId: string,
    actorId: string | null,
    correlationId: string | undefined,
    eventPayload: Record<string, unknown>,
  ): Promise<void> {
    await this.store.appendEvent(
      platformEvent(
        kind,
        entityId,
        actorId,
        correlationId ?? randomUUID(),
        eventPayload,
        this.now(),
      ),
    );
  }
}
