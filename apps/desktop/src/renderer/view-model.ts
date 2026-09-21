import type { AgentEvent } from '@astra/contracts';

export interface ProgressRow {
  eventId: string;
  label: string;
  kind: AgentEvent['type'];
}

export function deriveProgressRows(events: AgentEvent[]): ProgressRow[] {
  return events.map((event) => {
    let label: string = event.type;
    if ('summary' in event.payload && typeof event.payload.summary === 'string')
      label = event.payload.summary;
    else if (event.type === 'file.read') label = `Read ${event.payload.path}`;
    else if (event.type === 'patch.applied') label = `Updated ${event.payload.fileCount} file(s)`;
    else if (event.type === 'command.started' || event.type === 'command.completed')
      label = event.payload.command;
    else if (event.type === 'permission.requested')
      label = `Approval needed for ${event.payload.action}`;
    return { eventId: event.eventId, label, kind: event.type };
  });
}
