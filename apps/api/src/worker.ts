import { randomUUID } from 'node:crypto';
import { applyFoundationMigration, createPostgresStores } from '@astra/db';
import {
  AstraWorkerRuntime,
  AutomationScheduler,
  PlatformOrchestrationService,
  WorkerJobService,
  type Automation,
  type AutomationRun,
  type WorkerExecutor,
} from '@astra/orchestration';

const databaseUrl = process.env.ASTRA_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Worker requires ASTRA_DATABASE_URL or DATABASE_URL');

const stores = createPostgresStores(databaseUrl);
const migrationClient = await stores.pool.connect();
try {
  await applyFoundationMigration(migrationClient);
} finally {
  migrationClient.release();
}

const orchestration = new PlatformOrchestrationService({ store: stores.orchestration });
const jobs = new WorkerJobService({ store: stores.orchestration });
const workerId = process.env.ASTRA_WORKER_ID ?? `astra-worker-${randomUUID()}`;
const runtime = new AstraWorkerRuntime({
  jobs,
  workerId,
  pollMs: Number(process.env.ASTRA_WORKER_POLL_MS ?? 1_000),
});
const scheduler = new AutomationScheduler({
  store: stores.orchestration,
  workerId: `${workerId}:automation`,
});

/**
 * The worker owns durable claiming and state transitions. Actual repository
 * execution is an explicit isolated-plane integration and is fail-closed
 * until that executor is configured; this process never reports fake success.
 */
const executor: WorkerExecutor = async (job, signal) => {
  if (signal.aborted) throw new Error('WORKER_CANCELLED');
  const spec = await orchestration.getSpec(job.specId);
  const task = (await orchestration.listTasks(spec.id)).find(
    (candidate) => candidate.id === job.taskId,
  );
  if (!task) throw new Error('WORKER_TASK_NOT_FOUND');
  if (job.executionTarget !== 'ASTRA_CLOUD') throw new Error('WORKER_TARGET_NOT_ISOLATED');
  await stores.orchestration.appendEvent({
    id: randomUUID(),
    kind: 'worker.execution.claimed',
    entityId: job.id,
    actorId: job.workerId,
    correlationId: job.id,
    payload: { specId: spec.id, taskId: task.id, agentId: job.agentId },
    createdAt: new Date().toISOString(),
  });
  throw new Error('CLOUD_AGENT_EXECUTOR_NOT_CONFIGURED');
};

const automationExecutor = async (automation: Automation, _run: AutomationRun): Promise<void> => {
  void automation;
  void _run;
  throw new Error('AUTOMATION_EXECUTOR_NOT_CONFIGURED');
};

let stopping = false;
const tick = async (): Promise<void> => {
  if (stopping) return;
  await runtime.runOnce(executor);
  await scheduler.tick(automationExecutor);
};
const timer = setInterval(
  () => {
    void tick().catch((error) => console.error('[astra-worker]', error));
  },
  Number(process.env.ASTRA_WORKER_POLL_MS ?? 1_000),
);
timer.unref?.();
void tick().catch((error) => console.error('[astra-worker]', error));

const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await runtime.stop();
  await stores.pool.end();
};
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
