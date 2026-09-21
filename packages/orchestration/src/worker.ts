import { randomUUID } from 'node:crypto';
import {
  AutomationRunSchema,
  AutomationSchema,
  WorkerJobSchema,
  type Automation,
  type AutomationRun,
  type PlatformRecord,
  type WorkerJob,
} from './contracts.js';
import {
  platformEvent,
  platformRecord,
  PlatformConcurrencyError,
  type PlatformRecordStore,
} from './store.js';

export interface WorkerJobServiceOptions {
  store: PlatformRecordStore;
  now?: () => string;
  maxAttempts?: number;
}

function parsed<T>(record: PlatformRecord, parser: { parse(value: unknown): T }): T {
  return parser.parse(record.payload);
}

function expired(leaseExpiresAt: string | null, now: string): boolean {
  return Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) <= Date.parse(now));
}

export class WorkerJobService {
  private readonly store: PlatformRecordStore;
  private readonly now: () => string;
  private readonly maxAttempts: number;

  constructor(options: WorkerJobServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async enqueue(input: {
    ownerId: string;
    specId: string;
    taskId: string;
    agentId: string;
    executionTarget: WorkerJob['executionTarget'];
    maxAttempts?: number;
  }): Promise<WorkerJob> {
    const now = this.now();
    const job = WorkerJobSchema.parse({
      id: `job_${randomUUID()}`,
      ownerId: input.ownerId,
      specId: input.specId,
      taskId: input.taskId,
      agentId: input.agentId,
      executionTarget: input.executionTarget,
      state: 'QUEUED',
      workerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? this.maxAttempts,
      cancelRequested: false,
      failureReason: null,
      creditsSpent: '0',
      createdAt: now,
      updatedAt: now,
    });
    await this.store.put(platformRecord('WORKER_JOB', job.id, job.ownerId, job, now), null);
    await this.store.appendEvent(
      platformEvent(
        'worker.job.queued',
        job.id,
        job.ownerId,
        randomUUID(),
        { taskId: job.taskId },
        now,
      ),
    );
    return job;
  }

  async list(ownerId?: string): Promise<WorkerJob[]> {
    return (await this.store.list('WORKER_JOB', ownerId)).map((record) =>
      parsed(record, WorkerJobSchema),
    );
  }

  async get(jobId: string): Promise<WorkerJob> {
    return parsed(await this.require(jobId), WorkerJobSchema);
  }

  async claim(jobId: string, workerId: string, leaseMs: number): Promise<WorkerJob> {
    const record = await this.require(jobId);
    const current = parsed(record, WorkerJobSchema);
    const now = this.now();
    if (current.cancelRequested || current.state === 'CANCELLED')
      throw new Error('Worker job is cancelled');
    if (current.attempt >= current.maxAttempts) throw new Error('Worker job retry limit reached');
    if (!['QUEUED', 'EXPIRED'].includes(current.state) && !expired(current.leaseExpiresAt, now))
      throw new Error('Worker job is not claimable');
    const next = WorkerJobSchema.parse({
      ...current,
      state: 'CLAIMED',
      workerId,
      leaseId: `lease_${randomUUID()}`,
      leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
      attempt: current.attempt + 1,
      updatedAt: now,
    });
    try {
      await this.store.put(
        {
          ...record,
          version: record.version + 1,
          payload: next,
          status: next.state,
          updatedAt: now,
        },
        record.version,
      );
    } catch (error) {
      if (error instanceof PlatformConcurrencyError) throw new Error('Worker job claim conflict');
      throw error;
    }
    return next;
  }

  async renew(
    jobId: string,
    workerId: string,
    leaseId: string,
    leaseMs: number,
  ): Promise<WorkerJob> {
    const record = await this.require(jobId);
    const current = parsed(record, WorkerJobSchema);
    if (current.workerId !== workerId || current.leaseId !== leaseId)
      throw new Error('Worker lease owner mismatch');
    const now = this.now();
    const next = WorkerJobSchema.parse({
      ...current,
      leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
      updatedAt: now,
    });
    await this.store.put(
      { ...record, version: record.version + 1, payload: next, updatedAt: now },
      record.version,
    );
    return next;
  }

  async setState(
    jobId: string,
    workerId: string,
    leaseId: string,
    state: Extract<WorkerJob['state'], 'PREPARING' | 'RUNNING' | 'VERIFYING'>,
  ): Promise<WorkerJob> {
    const record = await this.require(jobId);
    const current = parsed(record, WorkerJobSchema);
    if (current.workerId !== workerId || current.leaseId !== leaseId)
      throw new Error('Worker lease owner mismatch');
    const now = this.now();
    const next = WorkerJobSchema.parse({ ...current, state, updatedAt: now });
    await this.store.put(
      { ...record, version: record.version + 1, payload: next, status: state, updatedAt: now },
      record.version,
    );
    return next;
  }

  async complete(
    jobId: string,
    workerId: string,
    leaseId: string,
    result: { state: 'COMPLETED' | 'FAILED'; failureReason?: string | null; creditsSpent?: string },
  ): Promise<WorkerJob> {
    const record = await this.require(jobId);
    const current = parsed(record, WorkerJobSchema);
    if (current.workerId !== workerId || current.leaseId !== leaseId)
      throw new Error('Worker lease owner mismatch');
    const now = this.now();
    const next = WorkerJobSchema.parse({
      ...current,
      state: result.state,
      leaseId: null,
      leaseExpiresAt: null,
      failureReason: result.failureReason ?? null,
      creditsSpent: result.creditsSpent ?? current.creditsSpent,
      updatedAt: now,
    });
    await this.store.put(
      {
        ...record,
        version: record.version + 1,
        payload: next,
        status: result.state,
        updatedAt: now,
      },
      record.version,
    );
    return next;
  }

  async cancel(jobId: string): Promise<WorkerJob> {
    const record = await this.require(jobId);
    const current = parsed(record, WorkerJobSchema);
    if (current.state === 'CANCELLED') return current;
    const now = this.now();
    const next = WorkerJobSchema.parse({
      ...current,
      state: ['COMPLETED', 'FAILED'].includes(current.state) ? current.state : 'CANCELLED',
      cancelRequested: true,
      leaseId: null,
      leaseExpiresAt: null,
      workerId: null,
      updatedAt: now,
    });
    await this.store.put(
      { ...record, version: record.version + 1, payload: next, status: next.state, updatedAt: now },
      record.version,
    );
    return next;
  }

  async recoverExpired(): Promise<WorkerJob[]> {
    const now = this.now();
    const recovered: WorkerJob[] = [];
    for (const record of await this.store.list('WORKER_JOB')) {
      const current = parsed(record, WorkerJobSchema);
      if (!['CLAIMED', 'PREPARING', 'RUNNING', 'VERIFYING'].includes(current.state)) continue;
      if (!expired(current.leaseExpiresAt, now)) continue;
      const next = WorkerJobSchema.parse({
        ...current,
        state: current.attempt >= current.maxAttempts ? 'FAILED' : 'EXPIRED',
        workerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        failureReason:
          current.attempt >= current.maxAttempts ? 'Lease expired after retry limit' : null,
        updatedAt: now,
      });
      try {
        await this.store.put(
          {
            ...record,
            version: record.version + 1,
            payload: next,
            status: next.state,
            updatedAt: now,
          },
          record.version,
        );
        recovered.push(next);
      } catch (error) {
        if (!(error instanceof PlatformConcurrencyError)) throw error;
      }
    }
    return recovered;
  }

  private async require(jobId: string): Promise<PlatformRecord> {
    const record = await this.store.get('WORKER_JOB', jobId);
    if (!record) throw new Error(`Worker job not found: ${jobId}`);
    return record;
  }
}

export type WorkerExecutor = (
  job: WorkerJob,
  signal: AbortSignal,
) => Promise<{ creditsSpent?: string } | void>;

export class AstraWorkerRuntime {
  private readonly jobs: WorkerJobService;
  private readonly workerId: string;
  private readonly pollMs: number;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly controllers = new Map<string, AbortController>();

  constructor(options: { jobs: WorkerJobService; workerId: string; pollMs?: number }) {
    this.jobs = options.jobs;
    this.workerId = options.workerId;
    this.pollMs = options.pollMs ?? 1_000;
  }

  async runOnce(executor: WorkerExecutor): Promise<WorkerJob | null> {
    await this.jobs.recoverExpired();
    for (const candidate of await this.jobs.list()) {
      if (!['QUEUED', 'EXPIRED'].includes(candidate.state) || candidate.cancelRequested) continue;
      let job: WorkerJob;
      try {
        job = await this.jobs.claim(candidate.id, this.workerId, Math.max(5_000, this.pollMs * 5));
      } catch {
        continue;
      }
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      const leaseMs = Math.max(5_000, this.pollMs * 5);
      const renewTimer = setInterval(
        () => {
          if (!job.leaseId || controller.signal.aborted) return;
          void this.jobs
            .renew(job.id, this.workerId, job.leaseId, leaseMs)
            .catch(() => controller.abort());
        },
        Math.max(1_000, Math.floor(leaseMs / 2)),
      );
      renewTimer.unref?.();
      try {
        await this.jobs.setState(job.id, this.workerId, job.leaseId!, 'PREPARING');
        await this.jobs.setState(job.id, this.workerId, job.leaseId!, 'RUNNING');
        const result = await executor(job, controller.signal);
        return await this.jobs.complete(job.id, this.workerId, job.leaseId!, {
          state: 'COMPLETED',
          ...(result?.creditsSpent === undefined ? {} : { creditsSpent: result.creditsSpent }),
        });
      } catch (error) {
        if (controller.signal.aborted) {
          await this.jobs.cancel(job.id);
          return this.jobs.get(job.id);
        }
        return this.jobs.complete(job.id, this.workerId, job.leaseId!, {
          state: 'FAILED',
          failureReason: error instanceof Error ? error.message : 'Worker execution failed',
        });
      } finally {
        clearInterval(renewTimer);
        this.controllers.delete(job.id);
      }
    }
    return null;
  }

  start(executor: WorkerExecutor): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.runOnce(executor).catch(() => undefined);
    }, this.pollMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  async cancel(jobId: string): Promise<WorkerJob> {
    const controller = this.controllers.get(jobId);
    controller?.abort();
    return this.jobs.cancel(jobId);
  }
}

function nextOccurrence(expression: string, scheduledFor: string): string {
  const date = new Date(scheduledFor);
  if (expression === '@daily') date.setUTCDate(date.getUTCDate() + 1);
  else if (expression === '@weekly') date.setUTCDate(date.getUTCDate() + 7);
  else {
    const match = /^\*\/(\d+) \* \* \* \*$/.exec(expression);
    if (!match) throw new Error(`Unsupported automation schedule: ${expression}`);
    date.setUTCMinutes(date.getUTCMinutes() + Number(match[1]));
  }
  return date.toISOString();
}

export class AutomationScheduler {
  private readonly store: PlatformRecordStore;
  private readonly now: () => string;
  private readonly workerId: string;
  constructor(options: { store: PlatformRecordStore; now?: () => string; workerId?: string }) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.workerId = options.workerId ?? `automation-worker-${randomUUID()}`;
  }

  async tick(
    executor: (automation: Automation, run: AutomationRun) => Promise<void>,
  ): Promise<AutomationRun[]> {
    const claimed: AutomationRun[] = [];
    for (const record of await this.store.list('AUTOMATION')) {
      const automation = parsed(record, AutomationSchema);
      const now = this.now();
      if (
        !automation.enabled ||
        !automation.nextRunAt ||
        Date.parse(automation.nextRunAt) > Date.parse(now)
      )
        continue;
      const scheduledFor = automation.nextRunAt;
      const runId = `automation-run:${automation.id}:${scheduledFor}`;
      let createdRun: AutomationRun | undefined;
      try {
        await this.store.transaction(async (transaction) => {
          if (await transaction.get('AUTOMATION_RUN', runId)) return;
          const runNow = this.now();
          createdRun = AutomationRunSchema.parse({
            id: runId,
            automationId: automation.id,
            ownerId: automation.ownerId,
            scheduledFor,
            state: 'QUEUED',
            workerId: null,
            leaseId: null,
            leaseExpiresAt: null,
            attempt: 0,
            failureReason: null,
            creditsSpent: '0',
            createdAt: runNow,
            updatedAt: runNow,
          });
          await transaction.put(
            platformRecord('AUTOMATION_RUN', createdRun.id, createdRun.ownerId, createdRun, runNow),
            null,
          );
          const updatedAutomation = AutomationSchema.parse({
            ...automation,
            lastRunAt: scheduledFor,
            nextRunAt: nextOccurrence(automation.trigger.expression, scheduledFor),
            lastResult: null,
            updatedAt: runNow,
          });
          await transaction.put(
            {
              ...record,
              version: record.version + 1,
              payload: updatedAutomation,
              updatedAt: runNow,
            },
            record.version,
          );
        });
      } catch (error) {
        if (error instanceof PlatformConcurrencyError) continue;
        throw error;
      }
      const run = createdRun;
      if (!run) continue;
      const current = await this.store.get('AUTOMATION_RUN', run.id);
      if (!current) continue;
      const nowIso = this.now();
      const leased = AutomationRunSchema.parse({
        ...run,
        state: 'CLAIMED',
        workerId: this.workerId,
        leaseId: `lease_${randomUUID()}`,
        leaseExpiresAt: new Date(Date.parse(nowIso) + 60_000).toISOString(),
        attempt: 1,
        updatedAt: nowIso,
      });
      try {
        await this.store.put(
          {
            ...current,
            version: current.version + 1,
            payload: leased,
            status: leased.state,
            updatedAt: nowIso,
          },
          current.version,
        );
      } catch (error) {
        if (error instanceof PlatformConcurrencyError) continue;
        throw error;
      }
      const running = AutomationRunSchema.parse({
        ...leased,
        state: 'RUNNING',
        updatedAt: this.now(),
      });
      const runningRecord = await this.store.get('AUTOMATION_RUN', run.id);
      if (!runningRecord) continue;
      await this.store.put(
        {
          ...runningRecord,
          version: runningRecord.version + 1,
          payload: running,
          status: running.state,
          updatedAt: running.updatedAt,
        },
        runningRecord.version,
      );
      let result: AutomationRun;
      try {
        await executor(automation, running);
        result = AutomationRunSchema.parse({
          ...running,
          state: 'COMPLETED',
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: this.now(),
        });
      } catch (error) {
        result = AutomationRunSchema.parse({
          ...running,
          state: 'FAILED',
          leaseId: null,
          leaseExpiresAt: null,
          failureReason: error instanceof Error ? error.message : 'Automation failed',
          updatedAt: this.now(),
        });
      }
      const finishedRecord = await this.store.get('AUTOMATION_RUN', run.id);
      if (finishedRecord)
        await this.store.put(
          {
            ...finishedRecord,
            version: finishedRecord.version + 1,
            payload: result,
            status: result.state,
            updatedAt: result.updatedAt,
          },
          finishedRecord.version,
        );
      const automationRecord = await this.store.get('AUTOMATION', automation.id);
      if (automationRecord) {
        const currentAutomation = parsed(automationRecord, AutomationSchema);
        const updatedAutomation = AutomationSchema.parse({
          ...currentAutomation,
          lastResult: result.state === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED',
          updatedAt: result.updatedAt,
        });
        await this.store.put(
          {
            ...automationRecord,
            version: automationRecord.version + 1,
            payload: updatedAutomation,
            updatedAt: result.updatedAt,
          },
          automationRecord.version,
        );
      }
      claimed.push(result);
    }
    return claimed;
  }
}
