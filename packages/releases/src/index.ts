import {
  createHash,
  sign as signDetached,
  verify as verifyDetached,
  type KeyLike,
} from 'node:crypto';
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

export function releaseManifestSigningPayload(
  manifest: Omit<ReleaseManifest, 'signature'> | ReleaseManifest,
): string {
  return JSON.stringify({
    version: manifest.version,
    channel: manifest.channel,
    platform: manifest.platform,
    arch: manifest.arch,
    installerUrl: manifest.installerUrl,
    sha256: manifest.sha256,
    size: manifest.size,
    minimumOs: manifest.minimumOs,
    publishedAt: manifest.publishedAt,
    releaseNotesUrl: manifest.releaseNotesUrl,
    mandatory: manifest.mandatory,
    rolloutPercentage: manifest.rolloutPercentage,
  });
}

export function signReleaseManifest(
  manifest: Omit<ReleaseManifest, 'signature'>,
  privateKey: KeyLike,
): string {
  return signDetached(
    null,
    Buffer.from(releaseManifestSigningPayload(manifest)),
    privateKey,
  ).toString('base64url');
}

export function verifyReleaseSignature(manifest: ReleaseManifest, publicKey: KeyLike): boolean {
  try {
    return verifyDetached(
      null,
      Buffer.from(releaseManifestSigningPayload(manifest)),
      publicKey,
      Buffer.from(manifest.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function verifyWindowsUpdatePayload(
  manifest: ReleaseManifest,
  bytes: Uint8Array,
  publicKey: KeyLike,
): boolean {
  return (
    bytes.byteLength === manifest.size &&
    verifyInstallerDigest(bytes, manifest.sha256) &&
    verifyReleaseSignature(manifest, publicKey)
  );
}
