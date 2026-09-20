import { describe, expect, it } from 'vitest';
import { MarketplaceRegistry } from '@lyntar/marketplace';

describe('marketplace trust boundary', () => {
  it('requires checksum/signature inspection and explicit permissions before install', () => {
    const marketplace = new MarketplaceRegistry();
    marketplace.publish({
      id: 'official.skill',
      type: 'skill',
      name: 'Official Skill',
      publisher: 'Astra AI',
      version: '1.0.0',
      description: 'A reviewed skill',
      permissions: ['read_workspace'],
      dependencies: [],
      license: 'UNLICENSED',
      compatibility: '^0.1.0',
      trust: 'Astra Official',
      checksum: 'sha256:abc',
      signature: 'sig:abc',
    });
    expect(() =>
      marketplace.install('official.skill', {
        checksum: 'sha256:wrong',
        signature: 'sig:abc',
        approvedPermissions: ['read_workspace'],
      }),
    ).toThrow('checksum');
    expect(() =>
      marketplace.install('official.skill', {
        checksum: 'sha256:abc',
        signature: 'sig:abc',
        approvedPermissions: [],
      }),
    ).toThrow('permission');
    const installed = marketplace.install('official.skill', {
      checksum: 'sha256:abc',
      signature: 'sig:abc',
      approvedPermissions: ['read_workspace'],
    });
    expect(installed.status).toBe('INSTALLED');
  });
});
