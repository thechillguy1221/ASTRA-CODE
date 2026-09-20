import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApi } from '@lyntar/api';
import { applyFoundationMigration, createPostgresStores } from '@lyntar/db';
import type { GatewayModelClient, GatewayRequest } from '@lyntar/model-gateway';
import { VercelGatewayClient } from '@lyntar/model-gateway';
import type { ModelStreamEvent } from '@lyntar/contracts';
import { DesktopRuntime } from '../../apps/desktop/electron/desktop-runtime.js';
import { resolveLiveConfiguration } from '../../scripts/certification.mjs';

const execFileAsync = promisify(execFile);
const liveConfiguration = resolveLiveConfiguration(process.env);
const missing = [
  ...('missing' in liveConfiguration ? liveConfiguration.missing : []),
  ...(process.env.LYNTAR_DATABASE_URL ? [] : ['LYNTAR_DATABASE_URL']),
];
const liveReady = missing.length === 0;
const temporaryRoots: string[] = [];

if (!liveReady) {
  console.warn(`[BLOCKED] Live agent certification requires: ${[...new Set(missing)].join(', ')}`);
}

async function git(root: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], { windowsHide: true });
}

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lyntar-live-agent-'));
  temporaryRoots.push(root);
  const repository = join(root, 'broken-node-app');
  await mkdir(repository);
  await cp('tests/fixtures/broken-node-app', repository, { recursive: true });
  await git(repository, 'init');
  await git(repository, 'config', 'user.email', 'test@lyntar.local');
  await git(repository, 'config', 'user.name', 'Lyntar Test');
  await git(repository, 'add', '.');
  await git(repository, 'commit', '-m', 'fixture');
  await writeFile(join(repository, 'README.md'), 'pre-existing note\n');
  return repository;
}

function makeObservedGateway(
  real: GatewayModelClient,
  onProviderStream: () => void,
): GatewayModelClient {
  return {
    async *complete(request: GatewayRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
      for await (const event of real.complete(request, signal)) {
        if (event.type === 'provider') onProviderStream();
        yield event;
      }
    },
  };
}

async function createLiveRuntime(onProviderStream?: () => void) {
  if (!liveReady) throw new Error('[BLOCKED] Live certification configuration is incomplete');
  const { apiKey, baseUrl, modelId } = liveConfiguration.credentials;
  const stores = createPostgresStores(process.env.LYNTAR_DATABASE_URL as string);
  const client = await stores.pool.connect();
  try {
    await applyFoundationMigration(client);
  } finally {
    client.release();
  }
  await stores.pool.query(
    `INSERT INTO model_catalog
       (model_id, display_name, gateway_model_id, provider_slug, provider, enabled, visible, capabilities, cost_metadata)
     VALUES ($1, $1, $1, 'gateway', 'gateway', true, true, $2::jsonb, '{}'::jsonb)
     ON CONFLICT (model_id) DO UPDATE SET
       gateway_model_id = EXCLUDED.gateway_model_id,
       enabled = true,
       visible = true`,
    [
      modelId,
      JSON.stringify({
        supportsTools: true,
        supportsStreaming: true,
        supportsReasoning: true,
        supportsStructuredOutput: true,
        supportsImageInput: false,
      }),
    ],
  );
  const realGateway = new VercelGatewayClient({ baseUrl, apiKey });
  const gateway = onProviderStream
    ? makeObservedGateway(realGateway, onProviderStream)
    : realGateway;
  const app = buildApi({ catalog: stores.catalog, receipts: stores.receipts, gateway });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    modelId,
    stores,
    app,
    runtime: new DesktopRuntime(address),
    async close(): Promise<void> {
      await app.close();
      await stores.pool.end();
    },
  };
}

function assertNoSecret(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(process.env.LYNTAR_MODEL_GATEWAY_API_KEY ?? '__missing_key__');
}

function printReceiptReport(label: string, receipts: Array<Record<string, unknown>>): void {
  const totalActualCost = receipts.every((receipt) => typeof receipt.actualCostUsd === 'number')
    ? receipts.reduce((sum, receipt) => sum + Number(receipt.actualCostUsd), 0)
    : null;
  const report = {
    label,
    requestIds: receipts.map((receipt) => receipt.requestId),
    gatewayRequestIds: receipts.map((receipt) => receipt.gatewayRequestId ?? 'unreported'),
    inputTokens: receipts.map((receipt) => receipt.inputTokens ?? null),
    outputTokens: receipts.map((receipt) => receipt.outputTokens ?? null),
    cacheReadTokens: receipts.map((receipt) => receipt.cacheReadTokens ?? null),
    actualCostUsd: totalActualCost,
  };
  assertNoSecret(report);
  console.log(`[LIVE-RECEIPT] ${JSON.stringify(report)}`);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('live agent certification', () => {
  if (!liveReady) {
    it.skip(`[BLOCKED] live credentials and PostgreSQL are required`, () => undefined);
    return;
  }

  it('Live Test A completes the simple coding task through the backend and persists receipts', async () => {
    const repository = await createFixture();
    const environment = await createLiveRuntime();
    try {
      await environment.runtime.openWorkspace(repository);
      const taskId = `live-simple-${randomUUID()}`;
      const result = await environment.runtime.startTask({
        taskId,
        prompt:
          'Fix the validation bug causing the specified test to fail. Do not modify the test. Inspect the relevant files, make the smallest safe change, and finish only after npm test passes.',
        modelId: environment.modelId,
        budget: {
          maxModelCalls: 4,
          maxRepairs: 2,
          maxCommands: 4,
          maxWallTimeMs: 120_000,
          maxEstimatedCostUsd: 0.25,
        },
      });
      expect(result.state).toBe('COMPLETED');
      expect(result.verification.status).toBe('passed');
      expect(result.gitDiff.lyntarPaths).toContain('src/validate.ts');
      expect(result.gitDiff.preExistingPaths).toContain('README.md');
      expect(result.usageReceipts.length).toBeGreaterThan(0);
      expect(result.usageSummary.actualCostUsd).not.toBeNull();
      expect(await environment.stores.receipts.listForTask(taskId)).toHaveLength(
        result.usageReceipts.length,
      );
      expect(await readFile(join(repository, 'test/validate.test.js'), 'utf8')).toContain(
        'name is required',
      );
      printReceiptReport('live-test-a', result.usageReceipts as Array<Record<string, unknown>>);
    } finally {
      await environment.close();
    }
  }, 180_000);

  it('Live Test B proves bounded repair and aggregates every model receipt', async () => {
    const repository = await createFixture();
    const environment = await createLiveRuntime();
    try {
      await environment.runtime.openWorkspace(repository);
      const taskId = `live-repair-${randomUUID()}`;
      const result = await environment.runtime.startTask({
        taskId,
        prompt:
          'Run the validation fixture. For certification, make an initial implementation edit that is intentionally insufficient so verification fails, then use the returned failure output to repair the implementation without changing the test. Stop after the final npm test passes.',
        modelId: environment.modelId,
        budget: {
          maxModelCalls: 4,
          maxRepairs: 2,
          maxCommands: 5,
          maxWallTimeMs: 120_000,
          maxEstimatedCostUsd: 0.35,
        },
      });
      expect(result.state).toBe('COMPLETED');
      expect(result.verification.status).toBe('passed');
      expect(result.events.some((event) => event.type === 'verification.failed')).toBe(true);
      expect(result.events.some((event) => event.type === 'repair.started')).toBe(true);
      expect(result.usageReceipts.length).toBeGreaterThanOrEqual(2);
      expect(result.usageSummary.actualCostUsd).not.toBeNull();
      expect(result.usageSummary.actualCostUsd).toBe(
        result.usageReceipts.reduce((sum, receipt) => sum + (receipt.actualCostUsd ?? 0), 0),
      );
      expect(await environment.stores.receipts.listForTask(taskId)).toHaveLength(
        result.usageReceipts.length,
      );
      printReceiptReport('live-test-b', result.usageReceipts as Array<Record<string, unknown>>);
    } finally {
      await environment.close();
    }
  }, 180_000);

  it('cancels a real streaming model request before any tool action starts', async () => {
    let providerStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => {
      providerStreamStarted = resolve;
    });
    const environment = await createLiveRuntime(providerStreamStarted);
    try {
      const repository = await createFixture();
      await environment.runtime.openWorkspace(repository);
      const taskId = `live-cancel-${randomUUID()}`;
      const pending = environment.runtime.startTask({
        taskId,
        prompt: 'Inspect the repository and wait for further instruction before changing files.',
        modelId: environment.modelId,
        budget: {
          maxModelCalls: 2,
          maxRepairs: 0,
          maxCommands: 1,
          maxWallTimeMs: 120_000,
          maxEstimatedCostUsd: 0.1,
        },
      });
      await streamStarted;
      environment.runtime.cancelTask(taskId);
      const result = await pending;
      expect(result.state).toBe('CANCELLED');
      expect(result.events.some((event) => event.type === 'task.cancelled')).toBe(true);
      expect(result.events.some((event) => event.type === 'tool.requested')).toBe(false);
      printReceiptReport(
        'live-cancellation',
        result.usageReceipts as Array<Record<string, unknown>>,
      );
    } finally {
      await environment.close();
    }
  }, 180_000);
});
