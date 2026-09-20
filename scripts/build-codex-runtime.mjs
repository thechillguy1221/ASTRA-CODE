import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outputRoot = resolve(root, 'apps/desktop/resources/codex');
const artifactName = 'codex-app-server.exe';
const artifactPath = resolve(outputRoot, artifactName);
const manifestPath = resolve(outputRoot, 'codex-runtime.json');
const licensePath = resolve(outputRoot, 'LICENSE');
const noticePath = resolve(outputRoot, 'NOTICE');
const upstreamCodexRoot = resolve(root, 'vendor/upstream/codex');

// Official, immutable release selected after comparing the app-server protocol
// sources against Astra's adapter. This is intentionally not "latest".
const sourceSha = '5c5308fc9a9ee789049d646ef11e5400384b9c6f';
const runtimeSourceSha = '106bdc71ea78c8cf4e22d7c643c1564de630b3c9';
const releaseTag = 'rust-v0.156.0-alpha.10';
const protocolFingerprint = '1b94b320c014fa02eb89bc613d7beef36b1a400d164eeeaad8dd716d6da81435';
const releaseAssetUrl = `https://github.com/openai/codex/releases/download/${releaseTag}/codex-app-server-x86_64-pc-windows-msvc.exe`;
const officialAssetSha256 = '616c4961d85c8faccf0c1ae5db3ce4dfd2de18422f6a9a5c5ebada9c96ad4395';
const adapterVersion = 'astra-codex-adapter-v1';

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function download(path) {
  const response = await fetch(releaseAssetUrl, {
    headers: { 'User-Agent': 'Astra-Code-runtime-acquisition' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body)
    throw new Error(`Official Codex runtime download failed: HTTP ${response.status}`);
  const finalHost = new URL(response.url).hostname;
  if (finalHost !== 'github.com' && finalHost !== 'release-assets.githubusercontent.com')
    throw new Error(`Official Codex runtime redirected to an unexpected host: ${finalHost}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
}

if (process.platform !== 'win32')
  throw new Error('The pinned Astra Code Windows runtime can only be acquired on Windows');

await mkdir(outputRoot, { recursive: true });
let needsDownload = true;
try {
  await access(artifactPath);
  needsDownload = (await sha256(artifactPath)) !== officialAssetSha256;
} catch {
  needsDownload = true;
}
if (needsDownload) {
  await rm(artifactPath, { force: true });
  console.log(`Downloading official Codex ${releaseTag} Windows x64 app-server...`);
  await download(artifactPath);
}

const artifactSha256 = await sha256(artifactPath);
if (artifactSha256 !== officialAssetSha256)
  throw new Error(
    `Official Codex runtime checksum mismatch: expected ${officialAssetSha256}, got ${artifactSha256}`,
  );

await copyFile(resolve(upstreamCodexRoot, 'LICENSE'), licensePath);
await copyFile(resolve(upstreamCodexRoot, 'NOTICE'), noticePath);

const manifest = {
  sourceSha,
  runtimeSourceSha,
  releaseTag,
  releaseAssetUrl,
  protocolFingerprint,
  adapterVersion,
  version: releaseTag,
  platform: 'win32',
  architecture: 'x64',
  artifactPath: artifactName,
  artifactSha256,
  artifact: { path: artifactName, sha256: artifactSha256 },
  args: ['--listen', 'stdio://', '--session-source', 'vscode'],
  acquisition: 'official-github-release',
  buildTimestamp: new Date().toISOString(),
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Official pinned Codex runtime verified at ${artifactPath}`);
console.log(`Codex runtime manifest written to ${manifestPath}`);
