import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ReleaseManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  channel: z.enum(['stable', 'beta', 'nightly']),
  platform: z.literal('win32'),
  arch: z.literal('x64'),
  installerUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), 'Installer must use HTTPS'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  signature: z.string().min(1),
  size: z.number().int().positive(),
  minimumOs: z.string().min(1),
  publishedAt: z.string().datetime(),
  releaseNotesUrl: z.string().url(),
  mandatory: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
});
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export interface UpdateClient {
  platform: string;
  arch: string;
  currentVersion: string;
}

function versionParts(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isNewer(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < next.length; index += 1) {
    if (next[index]! !== installed[index]!) return next[index]! > installed[index]!;
  }
  return false;
}

export function canInstallWindowsUpdate(manifest: ReleaseManifest, client: UpdateClient): boolean {
  return (
    manifest.platform === client.platform &&
    manifest.arch === client.arch &&
    manifest.rolloutPercentage > 0 &&
    isNewer(manifest.version, client.currentVersion)
  );
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyInstallerDigest(bytes: Uint8Array, expectedSha256: string): boolean {
  return sha256(bytes).toLowerCase() === expectedSha256.toLowerCase();
}
