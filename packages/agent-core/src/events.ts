import { randomUUID } from 'node:crypto';
import { AgentEventSchema, type AgentEvent } from '@lyntar/contracts';

export function createAgentEvent(
  taskId: string,
  type: AgentEvent['type'],
  payload: unknown,
): AgentEvent {
  return AgentEventSchema.parse({
    eventId: randomUUID(),
    taskId,
    occurredAt: new Date().toISOString(),
    type,
    payload,
  });
}

export class InMemoryEventPort {
  public readonly events: AgentEvent[] = [];

  append(event: AgentEvent): void {
    this.events.push(event);
  }
}
