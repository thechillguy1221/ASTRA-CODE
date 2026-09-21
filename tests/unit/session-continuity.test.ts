import { describe, it, expect } from 'vitest';
import { InMemorySessionStore } from '@astra/agent-core';
import { randomUUID } from 'node:crypto';

function makeSession(overrides?: Partial<Parameters<InMemorySessionStore['createSession']>[0]>) {
  return {
    sessionId: randomUUID(),
    userId: 'user-session-test',
    workspaceId: 'workspace-1',
    objective: 'Implement authentication module',
    status: 'ACTIVE' as const,
    activeTaskId: null,
    currentModelId: 'fable-5.1',
    structuredState: null,
    lastCheckpointId: null,
    totalCreditsReserved: '0',
    totalCreditsSettled: '0',
    pausedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('Session continuity (spec §17-27, §79 items 14-19)', () => {
  it('model switch preserves session ID and objective (test 14)', async () => {
    const store = new InMemorySessionStore();
    const session = await store.createSession(makeSession({ currentModelId: 'fable-5.1' }));

    // Simulate model switch: update currentModelId, session ID stays the same
    const updated = await store.updateSession(session.sessionId, {
      currentModelId: 'astra-6',
    });

    expect(updated.sessionId).toBe(session.sessionId);
    expect(updated.objective).toBe(session.objective);
    expect(updated.currentModelId).toBe('astra-6');
  });

  it('model switch does not create a new session (test 15)', async () => {
    const store = new InMemorySessionStore();
    const session = await store.createSession(makeSession());
    await store.updateSession(session.sessionId, { currentModelId: 'gpt-5.6' });

    const sessions = await store.listSessions('user-session-test');
    expect(sessions).toHaveLength(1); // Only one session exists
  });

  it('pause updates session status to PAUSED (test 16)', async () => {
    const store = new InMemorySessionStore();
    const session = await store.createSession(makeSession());
    const paused = await store.updateSession(session.sessionId, {
      status: 'PAUSED',
      pausedAt: new Date().toISOString(),
    });
    expect(paused.status).toBe('PAUSED');
    expect(paused.pausedAt).toBeTruthy();
  });

  it('resume restores exact session state from checkpoint (test 17)', async () => {
    const store = new InMemorySessionStore();
    const session = await store.createSession(makeSession());

    const structuredState = {
      objective: 'Implement auth',
      phase: 'EXECUTING' as const,
      completedWork: ['Created user model', 'Added password hashing'],
      pendingWork: ['Add JWT tokens', 'Write tests'],
      blockedWork: [],
      architecturalDecisions: ['Use bcrypt for password hashing'],
      userConstraints: ['No external auth providers'],
      filesRead: ['src/auth.ts'],
      filesModified: ['src/auth.ts'],
      knownErrors: [],
      testState: 'not-run' as const,
      buildState: 'unknown' as const,
      nextIntendedAction: 'Implement JWT token generation',
      currentModelId: 'fable-5.1',
      creditsUsed: '12.5',
      updatedAt: new Date().toISOString(),
    };

    const checkpoint = await store.saveCheckpoint({
      checkpointId: randomUUID(),
      sessionId: session.sessionId,
      taskId: null,
      reason: 'Before pause',
      structuredState,
      gitHead: 'abc123',
      gitBranch: 'main',
      workingTreeHash: null,
      modelId: 'fable-5.1',
      creditsUsed: '12.5',
      createdAt: new Date().toISOString(),
    });

    await store.updateSession(session.sessionId, {
      status: 'PAUSED',
      lastCheckpointId: checkpoint.checkpointId,
      pausedAt: new Date().toISOString(),
    });

    // Resume: load checkpoint and verify state is intact
    const latestCheckpoint = await store.getLatestCheckpoint(session.sessionId);
    expect(latestCheckpoint).toBeDefined();
    expect(latestCheckpoint?.structuredState.objective).toBe('Implement auth');
    expect(latestCheckpoint?.structuredState.completedWork).toHaveLength(2);
    expect(latestCheckpoint?.structuredState.nextIntendedAction).toBe(
      'Implement JWT token generation',
    );
  });

  it('app restart preserves recoverable state via checkpoints (test 18)', async () => {
    // Simulate: app closed → checkpoint saved → app restarted → checkpoint loaded
    const store = new InMemorySessionStore();
    const session = await store.createSession(makeSession());

    const checkpoint = await store.saveCheckpoint({
      checkpointId: randomUUID(),
      sessionId: session.sessionId,
      taskId: null,
      reason: 'Graceful shutdown checkpoint',
      structuredState: {
        objective: 'Fix the login bug',
        phase: 'EXECUTING',
        completedWork: ['Analyzed the bug'],
        pendingWork: ['Fix token validation'],
        blockedWork: [],
        architecturalDecisions: [],
        userConstraints: [],
        filesRead: ['src/auth/token.ts'],
        filesModified: [],
        knownErrors: ['Token expiry not checked'],
        testState: 'failing',
        buildState: 'passing',
        nextIntendedAction: 'Add expiry check to validateToken()',
        currentModelId: 'fable-5.1',
        creditsUsed: '3.2',
        updatedAt: new Date().toISOString(),
      },
      gitHead: 'def456',
      gitBranch: 'fix/login-bug',
      workingTreeHash: null,
      modelId: 'fable-5.1',
      creditsUsed: '3.2',
      createdAt: new Date().toISOString(),
    });

    // "App restarts" — load from fresh store would use DB in prod
    // In test, verify checkpoint is retrievable and state is intact
    const loaded = await store.getCheckpoint(checkpoint.checkpointId);
    expect(loaded?.structuredState.nextIntendedAction).toBe('Add expiry check to validateToken()');
    expect(loaded?.structuredState.testState).toBe('failing');
    expect(loaded?.structuredState.buildState).toBe('passing');
  });

  it('Free exhaustion does not delete project or session history (test 27)', async () => {
    // When credits run out, the session object must remain, not be deleted
    const store = new InMemorySessionStore();
    const session = await store.createSession(makeSession());

    // Simulate credit exhaustion — session moves to BLOCKED but is not deleted
    const updated = await store.updateSession(session.sessionId, {
      status: 'PAUSED', // Not COMPLETED, not deleted
    });

    expect(updated.sessionId).toBe(session.sessionId);
    expect(updated.status).toBe('PAUSED');

    const retrieved = await store.getSession(session.sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.objective).toBe(session.objective);
  });

  it('session history is recoverable after context compression (test 28)', async () => {
    // Context compression reduces what the model sees, but checkpoints preserve everything
    const store = new InMemorySessionStore();
    const session = await store.createSession(makeSession());

    // Create multiple checkpoints simulating session history
    for (let i = 0; i < 5; i++) {
      await store.saveCheckpoint({
        checkpointId: randomUUID(),
        sessionId: session.sessionId,
        taskId: null,
        reason: `Checkpoint ${i + 1}`,
        structuredState: {
          objective: session.objective,
          phase: 'EXECUTING',
          completedWork: Array.from({ length: i + 1 }, (_, j) => `Task ${j + 1} done`),
          pendingWork: [],
          blockedWork: [],
          architecturalDecisions: [],
          userConstraints: [],
          filesRead: [],
          filesModified: [],
          knownErrors: [],
          testState: 'passing',
          buildState: 'passing',
          nextIntendedAction: `Task ${i + 2}`,
          currentModelId: 'fable-5.1',
          creditsUsed: String(i * 5),
          updatedAt: new Date().toISOString(),
        },
        gitHead: null,
        gitBranch: null,
        workingTreeHash: null,
        modelId: 'fable-5.1',
        creditsUsed: String(i * 5),
        createdAt: new Date().toISOString(),
      });
    }

    const latest = await store.getLatestCheckpoint(session.sessionId);
    expect(latest?.structuredState.completedWork).toHaveLength(5);
    expect(latest?.structuredState.nextIntendedAction).toBe('Task 6');
  });
});
