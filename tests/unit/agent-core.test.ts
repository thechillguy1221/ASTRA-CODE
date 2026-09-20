import { describe, expect, it } from 'vitest';
import type { AgentEvent, GitDiff, ModelDecision, UsageReceipt } from '@lyntar/contracts';
import { AgentTaskRunner, InMemorySessionStore, type AgentPorts } from '@lyntar/agent-core';

function makePorts(
  decisions: ModelDecision[],
  verificationStatuses: Array<'passed' | 'failed'> = ['passed'],
): { ports: AgentPorts; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const diff: GitDiff = {
    lyntarPaths: ['src/file.ts'],
    preExistingPaths: [],
    mixedPaths: [],
    patch: 'diff',
  };
  const receipts: UsageReceipt[] = [];
  const ports: AgentPorts = {
    model: {
      async *complete() {
        const decision = decisions.shift();
        if (!decision) throw new Error('fake model exhausted');
        yield { type: 'decision' as const, decision };
      },
    },
    workspace: {
      async readFile() {
        return 'source';
      },
      async search() {
        return [];
      },
    },
    patch: {
      async apply() {
        return { paths: ['src/file.ts'], rolledBack: false };
      },
    },
    command: {
      async run() {
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false, truncated: false };
      },
    },
    git: {
      async captureBaseline() {
        return {
          repositoryRoot: 'C:\\repo',
          head: 'head',
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
        const status = verificationStatuses.shift() ?? 'passed';
        return {
          status,
          command: 'npm test',
          summary: status === 'passed' ? 'Verification passed' : 'Verification failed',
          stdout: '',
          stderr: status === 'passed' ? '' : 'failure',
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
        return { kind: 'allow' as const, reason: 'test policy' };
      },
    },
    receipts: {
      add(receipt) {
        receipts.push(receipt);
      },
      list() {
        return receipts;
      },
    },
  };
  return { ports, events };
}

describe('agent core', () => {
  it('executes a bounded inspect, patch, command, and verification task', async () => {
    const { ports, events } = makePorts([
      { kind: 'readFile', path: 'src/file.ts', summary: 'Inspecting implementation' },
      {
        kind: 'patch',
        summary: 'Updating implementation',
        files: [{ path: 'src/file.ts', content: 'fixed' }],
      },
      {
        kind: 'command',
        summary: 'Running tests',
        executable: 'npm',
        args: ['test'],
        cwdRelative: '.',
      },
      { kind: 'finish', summary: 'Verified implementation' },
    ]);
    const runner = new AgentTaskRunner(ports);
    const result = await runner.start({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      prompt: 'Fix the implementation',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 8,
        maxRepairs: 2,
        maxCommands: 6,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 1,
      },
    });

    expect(result.state).toBe('COMPLETED');
    expect(result.verification.status).toBe('passed');
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'task.started',
        'file.read',
        'patch.applied',
        'command.completed',
        'task.completed',
      ]),
    );
    expect(events).toHaveLength(result.events.length);
  });

  it('persists a compact session checkpoint without storing raw model context', async () => {
    const { ports } = makePorts([
      { kind: 'readFile', path: 'src/file.ts', summary: 'Inspecting implementation' },
      { kind: 'finish', summary: 'Verified implementation' },
    ]);
    const sessions = new InMemorySessionStore();
    ports.session = { store: sessions, userId: 'user-session' };

    const result = await new AgentTaskRunner(ports).start({
      taskId: 'task-session',
      agentSessionId: 'session-1',
      workspaceId: 'workspace-1',
      prompt: 'Explain the implementation and verify it',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 4,
        maxRepairs: 1,
        maxCommands: 2,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 1,
      },
    });

    const session = await sessions.getSession('session-1');
    const checkpoint = await sessions.getLatestCheckpoint('session-1');
    expect(result.state).toBe('COMPLETED');
    expect(session?.status).toBe('COMPLETED');
    expect(session?.lastCheckpointId).toBe(checkpoint?.checkpointId);
    expect(checkpoint?.structuredState.filesRead).toContain('src/file.ts');
    expect(JSON.stringify(checkpoint)).not.toContain('source');
  });

  it('stops after maxRepairs and reports BLOCKED', async () => {
    const { ports } = makePorts(
      [
        { kind: 'finish', summary: 'Initial result' },
        { kind: 'finish', summary: 'Still broken' },
      ],
      ['failed', 'failed'],
    );
    const runner = new AgentTaskRunner(ports);
    const result = await runner.start({
      taskId: 'task-2',
      workspaceId: 'workspace-1',
      prompt: 'Run the check',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 4,
        maxRepairs: 1,
        maxCommands: 4,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 1,
      },
    });

    expect(result.state).toBe('BLOCKED');
    expect(result.events.filter((event) => event.type === 'repair.started')).toHaveLength(1);
  });

  it('blocks when an actual model receipt exceeds the task cost ceiling', async () => {
    const { ports } = makePorts([{ kind: 'finish', summary: 'Result' }]);
    ports.model = {
      async *complete() {
        yield {
          type: 'usage' as const,
          receipt: {
            requestId: 'req-cost',
            taskId: 'task-cost',
            modelId: 'configured-model',
            providerRoute: 'gateway',
            inputTokens: 10,
            outputTokens: 10,
            cacheTokens: null,
            actualCostUsd: 0.06,
            receivedAt: new Date().toISOString(),
          },
        };
        yield {
          type: 'decision' as const,
          decision: { kind: 'finish' as const, summary: 'Result' },
        };
      },
    };
    const result = await new AgentTaskRunner(ports).start({
      taskId: 'task-cost',
      workspaceId: 'workspace-1',
      prompt: 'Run the check',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 2,
        maxRepairs: 0,
        maxCommands: 2,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 0.05,
      },
    });
    expect(result.state).toBe('BLOCKED');
    expect(result.summary).toContain('budget');
    expect(result.usageReceipts).toHaveLength(1);
    expect(result.usageSummary).toMatchObject({
      requestCount: 1,
      inputTokens: 10,
      outputTokens: 10,
      actualCostUsd: 0.06,
    });
  });

  it('waits for explicit bounded approval before continuing after an overrun', async () => {
    const { ports, events } = makePorts([{ kind: 'finish', summary: 'Result' }]);
    ports.model = {
      async *complete() {
        yield {
          type: 'usage' as const,
          receipt: {
            requestId: 'req-checkpoint',
            taskId: 'task-checkpoint',
            modelId: 'configured-model',
            providerRoute: 'gateway',
            inputTokens: 10,
            outputTokens: 10,
            cacheTokens: null,
            actualCostUsd: 0.06,
            receivedAt: new Date().toISOString(),
          },
        };
        yield {
          type: 'decision' as const,
          decision: { kind: 'finish' as const, summary: 'Result' },
        };
      },
    };
    const runner = new AgentTaskRunner(ports);
    ports.event = {
      async append(event) {
        events.push(event);
        if (event.type === 'permission.requested')
          runner.resolvePermission(event.taskId, event.payload.requestId, true);
      },
    };
    const result = await runner.start({
      taskId: 'task-checkpoint',
      workspaceId: 'workspace-1',
      prompt: 'Run the check',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 2,
        maxRepairs: 0,
        maxCommands: 2,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 0.05,
        overrunAllowanceUsd: 0.15,
        maxCostCheckpoints: 1,
      },
    });
    expect(result.state).toBe('COMPLETED');
    expect(
      events.some(
        (event) =>
          event.type === 'permission.requested' && event.payload.action === 'budget.overrun',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'permission.granted' && event.payload.action === 'budget.overrun',
      ),
    ).toBe(true);
  });

  it('blocks when the wall-time budget expires during a model request', async () => {
    const { ports } = makePorts([{ kind: 'finish', summary: 'unused' }]);
    ports.model = {
      async *complete(_request, signal) {
        await new Promise<never>((_resolve, reject) => {
          const abort = () => {
            const error = new Error('model request aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
        yield {
          type: 'decision' as const,
          decision: { kind: 'finish' as const, summary: 'unused' },
        };
      },
    };

    const result = await new AgentTaskRunner(ports).start({
      taskId: 'task-wall-time',
      workspaceId: 'workspace-1',
      prompt: 'Run the check',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 2,
        maxRepairs: 0,
        maxCommands: 2,
        maxWallTimeMs: 25,
        maxEstimatedCostUsd: 1,
      },
    });

    expect(result.state).toBe('BLOCKED');
    expect(result.summary).toContain('wallTime');
  });

  it('blocks a repeated identical tool loop before it can spend indefinitely', async () => {
    const repeatedRead = { kind: 'readFile' as const, path: 'src/file.ts', summary: 'Read file' };
    const { ports } = makePorts([
      repeatedRead,
      repeatedRead,
      repeatedRead,
      { kind: 'finish', summary: 'unused' },
    ]);
    const result = await new AgentTaskRunner(ports).start({
      taskId: 'task-runaway',
      workspaceId: 'workspace-1',
      prompt: 'Inspect the file',
      modelId: 'configured-model',
      budget: {
        maxModelCalls: 8,
        maxRepairs: 0,
        maxCommands: 2,
        maxWallTimeMs: 30_000,
        maxEstimatedCostUsd: 1,
      },
    });
    expect(result.state).toBe('BLOCKED');
    expect(result.summary).toContain('repeated identical action');
  });
});
