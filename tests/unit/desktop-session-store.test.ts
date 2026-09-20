import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSessionStore } from '../../apps/desktop/electron/session-store.js';

describe('desktop session persistence', () => {
  it('survives a new store instance using atomic metadata writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'astra-session-test-'));
    try {
      const first = new FileSessionStore(directory);
      await first.createSession({
        sessionId: 'session-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        objective: 'Fix the validation bug',
        status: 'ACTIVE',
        activeTaskId: 'task-1',
        currentModelId: 'model-1',
        structuredState: null,
        lastCheckpointId: null,
        totalCreditsReserved: '0',
        totalCreditsSettled: '0',
        pausedAt: null,
        completedAt: null,
      });
      await first.saveCheckpoint({
        checkpointId: 'checkpoint-1',
        sessionId: 'session-1',
        taskId: 'task-1',
        reason: 'Task completed',
        structuredState: {
          objective: 'Fix the validation bug',
          phase: 'COMPLETED',
          completedWork: ['Updated validation'],
          pendingWork: [],
          blockedWork: [],
          architecturalDecisions: [],
          userConstraints: [],
          filesRead: ['src/validate.ts'],
          filesModified: ['src/validate.ts'],
          knownErrors: [],
          testState: 'passing',
          buildState: 'unknown',
          nextIntendedAction: null,
          currentModelId: 'model-1',
          creditsUsed: '1.5',
          updatedAt: new Date().toISOString(),
        },
        gitHead: 'abc123',
        gitBranch: 'main',
        workingTreeHash: null,
        modelId: 'model-1',
        creditsUsed: '1.5',
        createdAt: new Date().toISOString(),
      });

      const restarted = new FileSessionStore(directory);
      expect((await restarted.getSession('session-1'))?.workspaceId).toBe('workspace-1');
      expect(
        (await restarted.getLatestCheckpoint('session-1'))?.structuredState.filesModified,
      ).toEqual(['src/validate.ts']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
