import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildApi,
  createMemoryCatalog,
  createMemoryEventStore,
  createMemoryReceiptStore,
} from '@lyntar/api';
import { DesktopRuntime } from '../../apps/desktop/electron/desktop-runtime.js';
import type { ModelDecision } from '@lyntar/contracts';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function git(root: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], { windowsHide: true });
}

describe('desktop runtime adapter', () => {
  it('runs the local repository vertical slice through the HTTP model boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-desktop-runtime-'));
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

    const decisions: ModelDecision[] = [
      {
        kind: 'readFile',
        path: 'src/validate.ts',
        summary: 'Inspecting validation implementation',
      },
      {
        kind: 'patch',
        summary: 'Applying initial validation fix',
        files: [
          {
            path: 'src/validate.ts',
            content:
              "export function validateInput(value) {\n  if (typeof value !== 'object' || value === null) throw new Error('input is required');\n  return { name: String(value.name ?? '') };\n}\n",
          },
        ],
      },
      { kind: 'finish', summary: 'Running verification' },
      {
        kind: 'patch',
        summary: 'Repairing empty-name validation',
        files: [
          {
            path: 'src/validate.ts',
            content:
              "export function validateInput(value) {\n  if (typeof value !== 'object' || value === null) throw new Error('input is required');\n  const name = String(value.name ?? '').trim();\n  if (!name) throw new Error('name is required');\n  return { name };\n}\n",
          },
        ],
      },
      { kind: 'finish', summary: 'Verification passed' },
    ];
    const catalog = createMemoryCatalog([
      {
        modelId: 'deterministic',
        displayName: 'Deterministic test model',
        gatewayModelId: 'test/deterministic',
        providerSlug: 'test',
        enabled: true,
        capabilities: {
          supportsTools: true,
          supportsStreaming: true,
          supportsReasoning: false,
          supportsStructuredOutput: true,
          supportsImageInput: false,
        },
      },
    ]);
    const eventStore = createMemoryEventStore();
    const app = buildApi({
      catalog,
      events: eventStore,
      receipts: createMemoryReceiptStore(),
      gateway: {
        async *complete() {
          const decision = decisions.shift();
          if (!decision) throw new Error('Deterministic model exhausted');
          yield { type: 'decision' as const, decision };
        },
      },
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    try {
      const runtime = new DesktopRuntime(address);
      const events: string[] = [];
      runtime.subscribe((event) => events.push(event.type));
      const workspace = await runtime.openWorkspace(repository);
      const models = await runtime.listModels();
      const result = await runtime.startTask({
        taskId: 'desktop-runtime-task',
        prompt: 'Fix the failing validation test without changing the test.',
        modelId: models[0].modelId,
        budget: {
          maxModelCalls: 8,
          maxRepairs: 2,
          maxCommands: 6,
          maxWallTimeMs: 60_000,
          maxEstimatedCostUsd: 1,
        },
      });

      expect(workspace.canonicalRoot).toBeTruthy();
      expect(models[0].modelId).toBe('deterministic');
      expect(result.state).toBe('COMPLETED');
      expect(result.verification.status).toBe('passed');
      expect(result.gitDiff.lyntarPaths).toEqual(['src/validate.ts']);
      expect(result.gitDiff.preExistingPaths).toContain('README.md');
      expect(events).toContain('task.completed');
      expect(await eventStore.listForTask('desktop-runtime-task')).toHaveLength(events.length);
      expect(await readFile(join(repository, 'test/validate.test.js'), 'utf8')).toContain(
        'name is required',
      );
    } finally {
      await app.close();
    }
  }, 20_000);
});
