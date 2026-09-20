import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  CodexAppServerClient,
  CodexRuntimeSupervisor,
} from '../packages/codex-runtime/dist/index.js';

if (process.platform !== 'win32') {
  throw new Error('Astra Code Codex runtime certification requires Windows x64.');
}

const runtimeRoot = resolve(process.env.ASTRA_CODEX_RUNTIME_ROOT ?? 'apps/desktop/resources/codex');
const manifestPath = join(runtimeRoot, 'codex-runtime.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const userDataPath = await mkdtemp(join(tmpdir(), 'astra-code-codex-cert-'));
const workspace = await mkdtemp(join(tmpdir(), 'astra-code-codex-workspace-'));
const apiBaseUrl =
  process.env.ASTRA_CODEX_RUNTIME_API_URL ?? 'http://127.0.0.1:4317/runtime/codex/v1';

const supervisor = new CodexRuntimeSupervisor({
  runtimeRoot,
  userDataPath,
  manifest,
  runtimeApiBaseUrl: apiBaseUrl,
  ...(process.env.ASTRA_CODEX_RUNTIME_AUTH
    ? { runtimeAuthToken: process.env.ASTRA_CODEX_RUNTIME_AUTH }
    : {}),
  environment: { ...process.env },
});

try {
  const client = new CodexAppServerClient(await supervisor.start());
  const initialized = await client.initialize({
    name: 'astra-code-certifier',
    title: 'Astra Code',
    version: '0.1.0',
  });
  const thread = await client.startThread({
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace],
    modelProvider: 'astra',
    approvalPolicy: 'never',
    sandbox: 'read-only',
  });
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        runtimeRoot,
        manifest: {
          sourceSha: manifest.sourceSha,
          runtimeSourceSha: manifest.runtimeSourceSha,
          releaseTag: manifest.releaseTag,
          protocolFingerprint: manifest.protocolFingerprint,
          artifactSha256: manifest.artifactSha256,
        },
        initialized,
        thread,
        isolatedUserDataPath: userDataPath,
      },
      null,
      2,
    ),
  );
  await client.stop();
} catch (error) {
  await supervisor.stop().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
}
