import { describe, expect, it } from 'vitest';
import { CancellationToken, waitForCancellation } from '@lyntar/agent-core';

describe('task cancellation', () => {
  it('aborts a child operation after cancellation', async () => {
    const token = new CancellationToken();
    const pending = waitForCancellation(token.signal);
    token.cancel('user stopped task');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves the cancellation reason for the task runner', () => {
    const token = new CancellationToken();
    token.cancel('user stopped task');
    expect(token.reason).toBe('user stopped task');
    expect(() => token.throwIfCancelled()).toThrow('user stopped task');
  });
});
