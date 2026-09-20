import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryEventStore } from '@lyntar/api';

describe('agent event API', () => {
  it('persists an append-only safe event and deduplicates delivery', async () => {
    const events = createMemoryEventStore();
    const app = buildApi({ events });
    const event = {
      eventId: 'event-1',
      taskId: 'task-1',
      occurredAt: new Date().toISOString(),
      type: 'task.started' as const,
      payload: { summary: 'Task started' },
    };

    const first = await app.inject({ method: 'POST', url: '/v1/agent-events', payload: event });
    const second = await app.inject({ method: 'POST', url: '/v1/agent-events', payload: event });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(await events.listForTask('task-1')).toHaveLength(1);
  });
});
