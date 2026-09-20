import { describe, expect, it } from 'vitest';
import { buildCapabilityApiForTest } from '../../apps/desktop/electron/ipc-handlers.js';

describe('desktop IPC boundary', () => {
  it('exposes capability methods but no generic fs or shell methods', () => {
    const api = buildCapabilityApiForTest();
    expect(api.workspace.readFile).toBeTypeOf('function');
    expect(api.agent.startTask).toBeTypeOf('function');
    expect((api as Record<string, unknown>).fs).toBeUndefined();
    expect((api as Record<string, unknown>).shell).toBeUndefined();
  });
});
