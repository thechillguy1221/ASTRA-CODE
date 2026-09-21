import { describe, expect, it } from 'vitest';
import {
  InMemoryPlatformRecordStore,
  ModelRouter,
  PlatformConcurrencyError,
  PlatformOrchestrationService,
  CreditBudgetService,
  evaluateToolPermission,
  type ModelRoute,
} from '@astra/orchestration';

const budget = { maxCredits: '10', maxModelCalls: 3, maxParallelAgents: 2, maxWallTimeMs: 30_000 };

function service() {
  return new PlatformOrchestrationService({
    store: new InMemoryPlatformRecordStore(),
    now: (() => {
      let counter = 0;
      return () => new Date(Date.UTC(2026, 0, 1, 0, 0, counter++)).toISOString();
    })(),
  });
}

describe('Astra orchestration platform', () => {
  it('persists a spec and rejects dependency cycles', async () => {
    const platform = service();
    const spec = await platform.createSpec({
      ownerId: 'user-1',
      title: 'Test',
      slug: 'test',
      objective: 'Ship it',
    });
    await expect(
      platform.addTasks({
        specId: spec.id,
        actorId: 'user-1',
        tasks: [
          {
            id: 'a',
            title: 'A',
            description: '',
            ownerAgentRole: 'BACKEND',
            dependencies: ['b'],
            affectedAreas: [],
            complexity: 'LOW',
            budget,
          },
          {
            id: 'b',
            title: 'B',
            description: '',
            ownerAgentRole: 'TEST',
            dependencies: ['a'],
            affectedAreas: [],
            complexity: 'LOW',
            budget,
          },
        ],
      }),
    ).rejects.toThrow('cycle');
  });

  it('runs independent ready tasks concurrently and gates dependent work', async () => {
    const platform = service();
    const spec = await platform.createSpec({
      ownerId: 'user-1',
      title: 'Parallel',
      slug: 'parallel',
      objective: 'Parallelize',
    });
    await platform.addTasks({
      specId: spec.id,
      actorId: 'user-1',
      tasks: [
        {
          id: 'a',
          title: 'A',
          description: '',
          ownerAgentRole: 'BACKEND',
          dependencies: [],
          affectedAreas: [],
          complexity: 'LOW',
          budget,
        },
        {
          id: 'b',
          title: 'B',
          description: '',
          ownerAgentRole: 'FRONTEND',
          dependencies: [],
          affectedAreas: [],
          complexity: 'LOW',
          budget,
        },
        {
          id: 'c',
          title: 'C',
          description: '',
          ownerAgentRole: 'TEST',
          dependencies: ['a', 'b'],
          affectedAreas: [],
          complexity: 'LOW',
          budget,
        },
      ],
    });
    const running: string[] = [];
    const first = await platform.runReadyTasks(
      { specId: spec.id, maxParallel: 2 },
      async (task) => {
        running.push(task.id);
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    );
    expect(first.map((item) => item.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect(running.sort()).toEqual(['a', 'b']);
    expect((await platform.readyTasks(spec.id)).map((task) => task.id)).toEqual(['c']);
  });

  it('redacts durable memory and requires independent verification', async () => {
    const platform = service();
    const saved = await platform.saveMemory({
      id: 'memory-1',
      projectId: 'project-1',
      kind: 'CORRECTION',
      title: 'Use token=secret',
      content: 'api_key=top-secret',
      provenance: 'USER',
      sourceTaskId: null,
      confidence: 'CONFIRMED',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(saved.content).toContain('[REDACTED]');
    const spec = await platform.createSpec({
      ownerId: 'user-1',
      title: 'Verify',
      slug: 'verify',
      objective: 'Verify',
    });
    expect(await platform.isVerified(spec.id)).toBe(false);
    await platform.recordVerification({
      specId: spec.id,
      taskId: null,
      category: 'UNIT',
      command: 'npm test',
      status: 'PASS',
      summary: 'passed',
      output: 'ok',
      correlationId: 'request-1',
      actorId: 'user-1',
    });
    expect(await platform.isVerified(spec.id)).toBe(true);
  });

  it('uses credit-aware route selection and ordered fallback without loops', () => {
    const routes: ModelRoute[] = [
      {
        modelId: 'fast',
        routeClass: 'STANDARD',
        fallbackModelIds: ['deep'],
        estimatedCredits: '1',
        enabled: true,
        planIds: [],
      },
      {
        modelId: 'deep',
        routeClass: 'STANDARD',
        fallbackModelIds: ['fast'],
        estimatedCredits: '5',
        enabled: true,
        planIds: [],
      },
    ];
    const resolved = new ModelRouter(routes).resolve({
      taskType: 'CODING',
      difficulty: 'MEDIUM',
      planId: 'FREE',
      remainingCredits: '3',
    });
    expect(resolved.selected.modelId).toBe('fast');
    expect(resolved.fallback.map((route) => route.modelId)).toEqual(['deep']);
  });

  it('protects optimistic versions in the record store', async () => {
    const store = new InMemoryPlatformRecordStore();
    const record = {
      kind: 'AGENT' as const,
      id: 'agent-1',
      ownerId: 'agent-1',
      version: 1,
      status: 'ACTIVE',
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.put(record, null);
    await expect(store.put({ ...record, version: 2 }, 9)).rejects.toBeInstanceOf(
      PlatformConcurrencyError,
    );
  });

  it('fails closed and applies agent, room, user, then organization permission precedence', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const entries = [
      {
        subjectId: 'org-1',
        scope: 'ORGANIZATION' as const,
        capability: 'terminal.write',
        decision: 'ALLOW' as const,
        allowedDomains: [],
        updatedAt: now,
      },
      {
        subjectId: 'user-1',
        scope: 'USER' as const,
        capability: 'terminal.write',
        decision: 'ALLOW' as const,
        allowedDomains: [],
        updatedAt: now,
      },
      {
        subjectId: 'room-1',
        scope: 'ROOM' as const,
        capability: 'terminal.write',
        decision: 'DENY' as const,
        allowedDomains: [],
        updatedAt: now,
      },
      {
        subjectId: 'agent-1',
        scope: 'AGENT' as const,
        capability: 'terminal.write',
        decision: 'ALLOW' as const,
        allowedDomains: [],
        updatedAt: now,
      },
    ];
    expect(
      evaluateToolPermission(entries, {
        capability: 'terminal.write',
        organizationId: 'org-1',
        userId: 'user-1',
        roomId: 'room-1',
        agentId: 'agent-1',
      }).decision,
    ).toBe('ALLOW');
    expect(
      evaluateToolPermission(entries.slice(0, 3), {
        capability: 'terminal.write',
        organizationId: 'org-1',
        userId: 'user-1',
        roomId: 'room-1',
      }).decision,
    ).toBe('DENY');
    expect(
      evaluateToolPermission(entries, {
        capability: 'filesystem.read',
        organizationId: 'org-1',
        userId: 'user-1',
      }).decision,
    ).toBe('DENY');
  });

  it('enforces task, agent, room, and organization credit caps with idempotent reservations', () => {
    const budgets = new CreditBudgetService([
      { scope: 'TASK', id: 'task-1', maxCredits: '10' },
      { scope: 'AGENT', id: 'agent-1', maxCredits: '8' },
      { scope: 'ROOM', id: 'room-1', maxCredits: '20' },
      { scope: 'ORGANIZATION', id: 'org-1', maxCredits: '100' },
    ]);
    const first = budgets.reserve({
      reservationId: 'reservation-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      roomId: 'room-1',
      organizationId: 'org-1',
      estimatedCredits: '6',
    });
    expect(
      budgets.reserve({
        reservationId: 'reservation-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        roomId: 'room-1',
        organizationId: 'org-1',
        estimatedCredits: '6',
      }),
    ).toEqual(first);
    expect(() =>
      budgets.reserve({
        reservationId: 'reservation-2',
        taskId: 'task-1',
        agentId: 'agent-1',
        roomId: 'room-1',
        organizationId: 'org-1',
        estimatedCredits: '3',
      }),
    ).toThrow('budget');
    expect(budgets.settle('reservation-1', '4')).toMatchObject({
      reservationId: 'reservation-1',
      chargedCredits: '4',
    });
    expect(budgets.settle('reservation-1', '4')).toMatchObject({
      reservationId: 'reservation-1',
      chargedCredits: '4',
    });
    expect(
      budgets.reserve({
        reservationId: 'reservation-3',
        taskId: 'task-1',
        agentId: 'agent-1',
        roomId: 'room-1',
        organizationId: 'org-1',
        estimatedCredits: '4',
      }),
    ).toMatchObject({ reservationId: 'reservation-3' });
  });
});
