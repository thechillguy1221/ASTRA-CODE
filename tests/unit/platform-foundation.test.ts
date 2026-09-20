import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  canInstallWindowsUpdate,
  ReleaseManifestSchema,
  sha256,
  signReleaseManifest,
  verifyReleaseSignature,
  verifyWindowsUpdatePayload,
} from '@lyntar/releases';
import { EmailPolicy } from '@lyntar/email';
import { RedactedLogger, SupportBundleBuilder } from '@lyntar/observability';

describe('platform foundations', () => {
  it('validates server-managed Windows release metadata before install', () => {
    const manifest = ReleaseManifestSchema.parse({
      version: '0.2.0',
      channel: 'stable',
      platform: 'win32',
      arch: 'x64',
      installerUrl: 'https://downloads.example.test/lyntar-0.2.0.exe',
      sha256: 'a'.repeat(64),
      signature: 'sig:test',
      size: 1234,
      minimumOs: 'Windows 10',
      publishedAt: new Date().toISOString(),
      releaseNotesUrl: 'https://example.test/releases/0.2.0',
      mandatory: false,
      rolloutPercentage: 100,
    });

    expect(
      canInstallWindowsUpdate(manifest, {
        platform: 'win32',
        arch: 'x64',
        currentVersion: '0.1.0',
      }),
    ).toBe(true);
    expect(
      canInstallWindowsUpdate(manifest, {
        platform: 'linux',
        arch: 'x64',
        currentVersion: '0.1.0',
      }),
    ).toBe(false);
  });

  it('requires a valid release signature and installer digest before update install', () => {
    const bytes = new TextEncoder().encode('Astra installer bytes');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const unsigned = {
      version: '0.2.0',
      channel: 'stable' as const,
      platform: 'win32' as const,
      arch: 'x64' as const,
      installerUrl: 'https://downloads.example.test/astra-0.2.0.exe',
      sha256: sha256(bytes),
      size: bytes.byteLength,
      minimumOs: 'Windows 10',
      publishedAt: new Date().toISOString(),
      releaseNotesUrl: 'https://example.test/releases/0.2.0',
      mandatory: false,
      rolloutPercentage: 100,
    };
    const manifest = ReleaseManifestSchema.parse({
      ...unsigned,
      signature: signReleaseManifest(unsigned, privateKey),
    });

    expect(verifyReleaseSignature(manifest, publicKey)).toBe(true);
    expect(verifyWindowsUpdatePayload(manifest, bytes, publicKey)).toBe(true);
    expect(
      verifyWindowsUpdatePayload(manifest, new TextEncoder().encode('tampered'), publicKey),
    ).toBe(false);
  });

  it('keeps transactional mail separate from consented marketing mail', () => {
    const policy = new EmailPolicy();
    expect(policy.canSend({ kind: 'transactional', verified: false, unsubscribed: false })).toBe(
      true,
    );
    expect(policy.canSend({ kind: 'marketing', verified: false, unsubscribed: false })).toBe(false);
    expect(policy.canSend({ kind: 'marketing', verified: true, unsubscribed: true })).toBe(false);
    expect(policy.canSend({ kind: 'marketing', verified: true, unsubscribed: false })).toBe(true);
  });

  it('redacts secrets and source content from logs and support bundles', () => {
    const logs: string[] = [];
    const logger = new RedactedLogger((line) => logs.push(line));
    logger.info('gateway request', {
      apiKey: 'secret-key',
      authorization: 'Bearer token',
      path: 'src/auth.ts',
    });
    expect(logs[0]).not.toContain('secret-key');
    expect(logs[0]).not.toContain('Bearer token');

    const bundle = new SupportBundleBuilder().build({
      appVersion: '0.1.0',
      platform: 'win32',
      diagnostics: { status: 'ok', sourceContent: 'private source', apiKey: 'secret-key' },
      errors: ['gateway timeout'],
    });
    expect(JSON.stringify(bundle)).not.toContain('private source');
    expect(JSON.stringify(bundle)).not.toContain('secret-key');
    expect(bundle.errors).toEqual(['gateway timeout']);
  });
});
