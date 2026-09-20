import { describe, expect, it } from 'vitest';
import { AgentEventSchema, IpcCommandSchema, TaskBudgetSchema } from '@lyntar/contracts';

describe('shared contracts', () => {
  it('accepts a bounded task budget and a safe agent event', () => {
    expect(
      TaskBudgetSchema.parse({
        maxModelCalls: 3,
        maxRepairs: 2,
        maxCommands: 6,
        maxWallTimeMs: 120_000,
        maxEstimatedCostUsd: 0.5,
      }).maxRepairs,
    ).toBe(2);

    expect(
      AgentEventSchema.parse({
        eventId: 'evt-1',
        taskId: 'task-1',
        occurredAt: new Date().toISOString(),
        type: 'task.started',
        payload: { summary: 'Inspecting repository' },
      }).type,
    ).toBe('task.started');
  });

  it('rejects generic filesystem and shell IPC commands', () => {
    expect(() => IpcCommandSchema.parse({ type: 'fs.readFile', path: 'x' })).toThrow();
    expect(() => IpcCommandSchema.parse({ type: 'shell.exec', command: 'dir' })).toThrow();
  });
});
