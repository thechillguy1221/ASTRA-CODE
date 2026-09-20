/* global console, process */

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentTaskRunner } from '../packages/agent-core/src/index.ts';
import {
  GitWorkspace,
  LocalCommandRunner,
  LocalWorkspace,
  verifyProject,
} from '../packages/workspace/src/index.ts';

const execFileAsync = promisify(execFile);
const rootDirectory = join(import.meta.dirname, '..');

async function git(root, ...args) {
  await execFileAsync('git', ['-C', root, ...args], { windowsHide: true });
}

async function runGoldenPath() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'lyntar-golden-command-'));
  const repository = join(temporaryRoot, 'broken-node-app');
  try {
    await mkdir(repository);
    await cp(join(rootDirectory, 'tests', 'fixtures', 'broken-node-app'), repository, {
      recursive: true,
    });
    await git(repository, 'init');
    await git(repository, 'config', 'user.email', 'test@lyntar.local');
    await git(repository, 'config', 'user.name', 'Lyntar Test');
    await git(repository, 'add', '.');
    await git(repository, 'commit', '-m', 'fixture');
    await writeFile(join(repository, 'README.md'), 'pre-existing note\n');

    const workspace = await LocalWorkspace.open(repository);
    const gitWorkspace = await GitWorkspace.open(repository);
    const decisions = [
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
    const receipts = [];
    const events = [];
    const ports = {
      model: {
        async *complete() {
          const decision = decisions.shift();
          if (!decision) throw new Error('Deterministic model exhausted');
          yield { type: 'decision', decision };
        },
      },
      workspace,
      patch: { apply: (batch) => workspace.writeBatch(batch) },
      command: {
        run: (request, signal) => new LocalCommandRunner(workspace.canonical).run(request, signal),
      },
      git: {
        captureBaseline: () => gitWorkspace.captureBaseline(),
        diffFromBaseline: (baseline) => gitWorkspace.diffFromBaseline(baseline),
      },
      verification: {
        verify: async (signal) => {
          const result = await verifyProject(workspace.canonical, signal);
          return {
            status: result.status,
            ...(result.command ? { command: result.command } : {}),
            summary: result.summary,
            stdout: result.result?.stdout ?? '',
            stderr: result.result?.stderr ?? '',
          };
        },
      },
      event: { append: (event) => events.push(event) },
      permission: {
        evaluate: async () => ({ kind: 'allow', reason: 'safe local fixture operation' }),
      },
      receipts: { add: (receipt) => receipts.push(receipt), list: () => [...receipts] },
    };

    return await new AgentTaskRunner(ports).start({
      taskId: 'golden-path-command',
      workspaceId: 'local-golden-workspace',
      prompt: 'Fix the failing validation test without changing the test.',
      modelId: 'deterministic-certification-model',
      budget: {
        maxModelCalls: 8,
        maxRepairs: 2,
        maxCommands: 6,
        maxWallTimeMs: 60_000,
        maxEstimatedCostUsd: 1,
      },
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  const result = await runGoldenPath();
  const report = {
    state: result.state,
    summary: result.summary,
    changedFiles: {
      lyntar: result.gitDiff.lyntarPaths,
      preExisting: result.gitDiff.preExistingPaths,
      mixed: result.gitDiff.mixedPaths,
    },
    verification: {
      status: result.verification.status,
      command: result.verification.command ?? null,
      summary: result.verification.summary,
    },
    receipts: result.usageReceipts.map((receipt) => ({
      requestId: receipt.requestId,
      taskId: receipt.taskId,
      modelId: receipt.modelId,
      providerRoute: receipt.providerRoute,
      inputTokens: receipt.inputTokens,
      outputTokens: receipt.outputTokens,
      cacheTokens: receipt.cacheTokens,
      actualCostUsd: receipt.actualCostUsd,
      receivedAt: receipt.receivedAt,
    })),
    unresolvedIssues: result.unresolvedIssues,
    eventTypes: result.events.map((event) => event.type),
  };
  console.log(JSON.stringify(report, null, 2));
  if (result.state !== 'COMPLETED' || result.verification.status !== 'passed') process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      state: 'FAILED',
      error: error instanceof Error ? error.message.slice(0, 500) : 'Golden path failed',
    }),
  );
  process.exitCode = 1;
}
