import { describe, expect, it } from 'vitest';

describe('repository tooling', () => {
  it('declares the foundation workspaces and verification scripts', async () => {
    const manifest = await import('../../package.json');
    expect(manifest.default.workspaces).toEqual(['apps/*', 'packages/*']);
    expect(manifest.default.scripts.test).toBeDefined();
    expect(manifest.default.scripts.typecheck).toBeDefined();
    expect(manifest.default.scripts.build).toBeDefined();
  });
});
