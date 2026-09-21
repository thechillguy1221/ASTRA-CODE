import { describe, expect, it } from 'vitest';
import type { AgentEvent, GitDiff, ModelDecision } from '@astra/contracts';
import { AgentTaskRunner, type AgentPorts } from '@astra/agent-core';

describe('agent cancellation', () => {
  it('cancels a running command and emits task.cancelled', async () => {
    const events: AgentEvent[] = [];
    const diff: GitDiff = { astraPaths: [], preExistingPaths: [], mixedPaths: [], patch: '' };
    let markCommandStarted!: () => void;
    const commandStarted = new Promise<void>((resolve) => {
      markCommandStarted = resolve;
    });
    const ports: AgentPorts = {
      model: {
        async *complete() {
          const decision: ModelDecision = {
            kind: 'command',
            summary: 'Running long command',
            executable: 'node',
            args: ['long.js'],
            cwdRelative: '.',
          };
          yield { type: 'decision' as const, decision };
        },
      },
      workspace: {
        async readFile() {
          return '';
        },
        async search() {
          return [];
        },
      },
      patch: {
        async apply() {
          return { paths: [], rolledBack: false };
        },
      },
      command: {
        async run(_request, signal) {
          return new Promise((_, reject) => {
            markCommandStarted();
            if (signal.aborted) {
              const error = new Error('stopped');
              error.name = 'AbortError';
              reject(error);
              return;
            }
            signal.addEventListener(
              'abort',
              () => {
                const error = new Error('stopped');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          });
        },
      },
      git: {
        async captureBaseline() {
          return {
            repositoryRoot: 'C:\\repo',
            head: null,
            statusPaths: [],
            fileHashes: {},
            capturedAt: new Date().toISOString(),
          };
        },
        async diffFromBaseline() {
          return diff;
        },
      },
      verification: {
        async verify() {
          return { status: 'passed' as const, summary: 'ok', stdout: '', stderr: '' };
        },
      },
      event: {
        async append(event) {
          events.push(event);
        },
      },
      permission: {
        async evaluate() {
          return { kind: 'allow' as const, reason: 'test policy' };
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
    const resultPromise = runner.start({
      taskId: 'task-cancel',
      workspaceId: 'workspace-1',
      prompt: 'Run the command',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 2,
        maxRepairs: 0,
        maxCommands: 2,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 1,
      },
    });
    await commandStarted;
    runner.cancel('task-cancel', 'user stopped task');
    const result = await resultPromise;
    expect(result.state).toBe('CANCELLED');
    expect(result.events.at(-1)?.type).toBe('task.cancelled');
  });

  it('cancels a task waiting for permission before a sensitive command', async () => {
    const events: AgentEvent[] = [];
    let permissionRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      permissionRequested = resolve;
    });
    const ports: AgentPorts = {
      model: {
        async *complete() {
          yield {
            type: 'decision' as const,
            decision: {
              kind: 'command' as const,
              summary: 'Run sensitive command',
              executable: 'cmd.exe',
              args: ['/c', 'echo test'],
              cwdRelative: '.',
            },
          };
        },
      },
      workspace: {
        async readFile() {
          return '';
        },
        async search() {
          return [];
        },
      },
      patch: {
        async apply() {
          return { paths: [], rolledBack: false };
        },
      },
      command: {
        async run() {
          throw new Error('command must not run before approval');
        },
      },
      git: {
        async captureBaseline() {
          return {
            repositoryRoot: 'C:\\repo',
            head: null,
            statusPaths: [],
            fileHashes: {},
            capturedAt: new Date().toISOString(),
          };
        },
        async diffFromBaseline() {
          return { astraPaths: [], preExistingPaths: [], mixedPaths: [], patch: '' };
        },
      },
      verification: {
        async verify() {
          return { status: 'passed' as const, summary: 'ok', stdout: '', stderr: '' };
        },
      },
      event: {
        async append(event) {
          events.push(event);
          if (event.type === 'permission.requested') permissionRequested();
        },
      },
      permission: {
        async evaluate() {
          return { kind: 'request' as const, reason: 'sensitive command' };
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
    const resultPromise = runner.start({
      taskId: 'task-permission-cancel',
      workspaceId: 'workspace-1',
      prompt: 'Run the command',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 2,
        maxRepairs: 0,
        maxCommands: 2,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 1,
      },
    });
    await requested;
    runner.cancel('task-permission-cancel', 'user stopped task');
    const result = await resultPromise;

    expect(result.state).toBe('CANCELLED');
    expect(events.at(-1)?.type).toBe('task.cancelled');
  });
});
