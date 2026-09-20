import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CODEX_ADAPTER_VERSION,
  CodexRuntimeError,
  CodexRuntimeSupervisor,
  PINNED_CODEX_SOURCE_SHA,
  validateCodexRuntimeManifest,
} from '@lyntar/codex-runtime';

async function hash(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('CodexRuntimeSupervisor', () => {
  it('validates manifest shape without accepting it as a pinned runtime by itself', () => {
    expect(() =>
      validateCodexRuntimeManifest({
        sourceSha: '0'.repeat(40),
        protocolFingerprint: 'protocol-v1',
        adapterVersion: CODEX_ADAPTER_VERSION,
        version: 'test',
        artifactPath: 'codex-app-server.exe',
        artifactSha256: '0'.repeat(64),
        args: [],
      }),
    ).not.toThrow();
    expect(PINNED_CODEX_SOURCE_SHA).toHaveLength(40);
  });

  it('fails closed when a pinned artifact is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astra-codex-missing-'));
    try {
      const supervisor = new CodexRuntimeSupervisor({
        runtimeRoot: root,
        userDataPath: root,
        manifest: {
          sourceSha: PINNED_CODEX_SOURCE_SHA,
          protocolFingerprint: 'protocol-v1',
          adapterVersion: CODEX_ADAPTER_VERSION,
          version: 'test',
          artifactPath: 'codex-app-server.exe',
          artifactSha256: '0'.repeat(64),
          args: [],
        },
      });
      await expect(supervisor.start()).rejects.toMatchObject<CodexRuntimeError>({
        code: 'MISSING_ARTIFACT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('launches only the hashed artifact with an isolated provider environment', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'astra-codex-fixture-'));
    try {
      const runtimeRoot = dirname(process.execPath);
      const artifact = process.execPath;
      const childScript =
        "process.stdout.write(JSON.stringify({method:'fixture.environment',params:{openAiKey:process.env.OPENAI_API_KEY??null,codexHome:process.env.CODEX_HOME??null}})+'\\n');process.exit(0)";
      const supervisor = new CodexRuntimeSupervisor({
        runtimeRoot,
        userDataPath: userData,
        environment: { ...process.env, OPENAI_API_KEY: 'must-not-cross-boundary' },
        manifest: {
          sourceSha: PINNED_CODEX_SOURCE_SHA,
          protocolFingerprint: 'protocol-v1',
          adapterVersion: CODEX_ADAPTER_VERSION,
          version: 'fixture',
          artifactPath: basename(artifact),
          artifactSha256: await hash(artifact),
          args: ['-e', childScript],
        },
      });
      const session = await supervisor.start();
      const event = await new Promise<Record<string, unknown>>((resolveEvent) => {
        const unsubscribe = session.onEvent((value) => {
          unsubscribe();
          resolveEvent(value);
        });
      });
      expect(event).toMatchObject({
        method: 'fixture.environment',
        params: { openAiKey: null },
      });
      expect((event.params as Record<string, unknown>).codexHome).toContain(
        join(userData, 'runtime', 'codex'),
      );
      await supervisor.stop();
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });
});
