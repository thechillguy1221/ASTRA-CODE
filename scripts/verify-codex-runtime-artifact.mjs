import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runtimeDirectory = join(root, 'apps', 'desktop', 'resources', 'codex');
const executable = join(runtimeDirectory, 'codex-app-server.exe');
const manifestPath = join(runtimeDirectory, 'codex-runtime.json');
const licensePath = join(runtimeDirectory, 'LICENSE');
const noticePath = join(runtimeDirectory, 'NOTICE');
const clineLicensePath = join(root, 'apps', 'desktop', 'resources', 'licenses', 'CLINE-LICENSE');

async function requireFile(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

await requireFile(executable, 'bundled Codex app-server executable');
await requireFile(manifestPath, 'Codex runtime manifest');
await requireFile(licensePath, 'bundled Codex Apache-2.0 license');
await requireFile(noticePath, 'bundled Codex attribution notice');
await requireFile(clineLicensePath, 'bundled Cline Apache-2.0 license');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (
  manifest.artifact?.path !== 'codex-app-server.exe' ||
  manifest.artifactPath !== 'codex-app-server.exe'
)
  throw new Error('Codex runtime manifest does not identify codex-app-server.exe');
if (typeof manifest.sourceSha !== 'string' || !/^[0-9a-f]{40}$/i.test(manifest.sourceSha))
  throw new Error('Codex runtime manifest has no valid pinned source SHA');
if (
  typeof manifest.protocolFingerprint !== 'string' ||
  !/^[0-9a-f]{64}$/i.test(manifest.protocolFingerprint)
)
  throw new Error('Codex runtime manifest has no valid protocol fingerprint');
if (manifest.runtimeSourceSha !== '106bdc71ea78c8cf4e22d7c643c1564de630b3c9')
  throw new Error('Codex runtime manifest is not the pinned official release source');
if (manifest.releaseTag !== 'rust-v0.156.0-alpha.10')
  throw new Error('Codex runtime manifest is not the pinned official release tag');

const hash = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex');
if (manifest.artifact.sha256 !== hash || manifest.artifactSha256 !== hash)
  throw new Error(
    `Codex runtime artifact hash mismatch: expected ${manifest.artifact.sha256}, got ${hash}`,
  );

const licenseHash = createHash('sha256')
  .update(await readFile(licensePath))
  .digest('hex');
if (licenseHash !== 'aa5e89edcbbd01fc3fb188a527d8bdc0da5812305cab220c84348c14ea427288')
  throw new Error(`Codex LICENSE hash mismatch: got ${licenseHash}`);

const noticeHash = createHash('sha256')
  .update(await readFile(noticePath))
  .digest('hex');
if (noticeHash !== '3c505dc54be731583470ef3584e5cb96d60df7add3e7e36294cf4dea8316a5cb')
  throw new Error(`Codex NOTICE hash mismatch: got ${noticeHash}`);

const clineLicenseHash = createHash('sha256')
  .update(await readFile(clineLicensePath))
  .digest('hex');
if (clineLicenseHash !== 'f704446a5f1271608805598b557e4288cf8580477ea038c9c3d8b361f693f6b8')
  throw new Error(`Cline LICENSE hash mismatch: got ${clineLicenseHash}`);

console.log(`Codex runtime artifact verified: ${manifest.sourceSha}/${hash}`);
