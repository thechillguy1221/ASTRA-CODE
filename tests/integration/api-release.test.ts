import { describe, expect, it } from 'vitest';
import { buildApi } from '@lyntar/api';

describe('release manifest API', () => {
  it('serves only server-managed Windows release metadata', async () => {
    const app = buildApi({
      releaseManifest: {
        version: '0.2.0',
        channel: 'stable',
        platform: 'win32',
        arch: 'x64',
        installerUrl: 'https://downloads.example.test/lyntar.exe',
        sha256: 'a'.repeat(64),
        signature: 'sig:test',
        size: 1234,
        minimumOs: 'Windows 10',
        publishedAt: new Date().toISOString(),
        releaseNotesUrl: 'https://example.test/release',
        mandatory: false,
        rolloutPercentage: 100,
      },
    });
    const response = await app.inject({ method: 'GET', url: '/v1/releases/windows/stable' });
    expect(response.statusCode).toBe(200);
    expect(response.json().release.arch).toBe('x64');
    expect((await app.inject({ method: 'GET', url: '/v1/releases/windows/beta' })).statusCode).toBe(
      404,
    );
  });
});
