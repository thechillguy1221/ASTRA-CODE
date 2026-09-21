import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_NOTIFY_CHANNEL,
  formatInvalidationPayload,
  parseInvalidationPayload,
  runControlPlaneTransaction,
} from '@astra/db';

describe('postgres control-plane adapter', () => {
  it('uses a stable notification channel and JSON payload', () => {
    const payload = { domain: 'plans' as const, resourceId: 'PRO', version: 2 };
    expect(CONTROL_PLANE_NOTIFY_CHANNEL).toBe('astra_control_plane_changed');
    expect(parseInvalidationPayload(formatInvalidationPayload(payload))).toEqual(payload);
  });

  it('commits the mutation transaction and rolls back failed work', async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql.trim());
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as never;

    await runControlPlaneTransaction(pool, async () => 'committed');
    expect(calls.slice(0, 2)).toEqual(['BEGIN', 'COMMIT']);

    calls.length = 0;
    await expect(
      runControlPlaneTransaction(pool, async () => {
        throw new Error('mutation failed');
      }),
    ).rejects.toThrow('mutation failed');
    expect(calls.slice(0, 2)).toEqual(['BEGIN', 'ROLLBACK']);
  });
});
