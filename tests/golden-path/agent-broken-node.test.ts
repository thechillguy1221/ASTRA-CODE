import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentTaskRunner, type AgentPorts } from '@lyntar/agent-core';
import { GitWorkspace, LocalCommandRunner, LocalWorkspace, verifyProject } from '@lyntar/workspace';
import type { AgentEvent, ModelDecision } from '@lyntar/contracts';

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

describe('agent golden path', () => {
  it('repairs a broken validation implementation without changing the test', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-golden-'));
    temporaryRoots.push(root);
    const repo = join(root, 'broken-node-app');
    await mkdir(repo);
    await cp('tests/fixtures/broken-node-app', repo, { recursive: true });
    await git(repo, 'init');
    await git(repo, 'config', 'user.email', 'test@lyntar.local');
    await git(repo, 'config', 'user.name', 'Lyntar Test');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'fixture');
    await writeFile(join(repo, 'README.md'), 'pre-existing note\n');

    const workspace = await LocalWorkspace.open(repo);
    const gitWorkspace = await GitWorkspace.open(repo);
    const events: AgentEvent[] = [];
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
    const ports: AgentPorts = {
      model: {
        async *complete() {
          const decision = decisions.shift();
          if (!decision) throw new Error('model exhausted');
          yield { type: 'decision' as const, decision };
        },
      },
      workspace,
      patch: {
        async apply(batch) {
          return workspace.writeBatch(batch);
        },
      },
      command: {
        async run(request, signal) {
          return new LocalCommandRunner(workspace.canonical).run(request, signal);
        },
      },
      git: {
        async captureBaseline() {
          return gitWorkspace.captureBaseline();
        },
        async diffFromBaseline(baseline) {
          return gitWorkspace.diffFromBaseline(baseline);
        },
      },
      verification: {
        async verify(signal) {
          const result = await verifyProject(workspace.canonical, signal);
          return {
            status: result.status,
            command: result.command,
            summary: result.summary,
            stdout: result.result?.stdout ?? '',
            stderr: result.result?.stderr ?? '',
          };
        },
      },
      event: {
        async append(event) {
          events.push(event);
        },
      },
      permission: {
        async evaluate() {
          return { kind: 'allow' as const, reason: 'safe local fixture operation' };
        },
      },
      receipts: {
        add() {},
        list() {
          return [];
        },
      },
    };

    const runner = new AgentTaskRunner(ports);
    const result = await runner.start({
      taskId: 'golden-task',
      workspaceId: 'golden-workspace',
      prompt: 'Fix the failing validation test without changing the test.',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 8,
        maxRepairs: 2,
        maxCommands: 6,
        maxWallTimeMs: 60_000,
        maxEstimatedCostUsd: 1,
      },
    });

    expect(result.state).toBe('COMPLETED');
    expect(result.verification.status).toBe('passed');
    expect(result.gitDiff.lyntarPaths).toEqual(['src/validate.ts']);
    expect(result.gitDiff.preExistingPaths).toContain('README.md');
    expect(await readFile(join(repo, 'test/validate.test.js'), 'utf8')).toContain(
      'name is required',
    );
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'task.started',
        'file.read',
        'patch.applied',
        'command.completed',
        'verification.failed',
        'repair.started',
        'task.completed',
      ]),
    );
    expect(events).toHaveLength(result.events.length);
  }, 15_000);
});
