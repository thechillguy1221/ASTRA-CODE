import { describe, expect, it } from 'vitest';
import { deriveProgressRows } from '../../apps/desktop/src/renderer/view-model.js';

describe('desktop progress view model', () => {
  it('maps append-only events into concise progress rows without raw reasoning', () => {
    const rows = deriveProgressRows([
      {
        eventId: 'event-1',
        taskId: 'task-1',
        occurredAt: new Date().toISOString(),
        type: 'model.completed',
        payload: { summary: 'Inspecting authentication flow' },
      },
    ]);
    expect(rows[0]?.label).toBe('Inspecting authentication flow');
    expect(JSON.stringify(rows)).not.toContain('scratchpad');
  });
});
