import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASTRA_CODEX_DYNAMIC_TOOLS,
  CODEX_ADAPTER_VERSION,
  CODEX_PROTOCOL_FINGERPRINT,
  CodexAppServerClient,
  CodexRuntimeError,
  CodexRuntimeSupervisor,
  PINNED_CODEX_SOURCE_SHA,
  validateCodexRuntimeManifest,
} from '@astra/codex-runtime';

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
        protocolFingerprint: CODEX_PROTOCOL_FINGERPRINT,
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
          protocolFingerprint: CODEX_PROTOCOL_FINGERPRINT,
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
          protocolFingerprint: CODEX_PROTOCOL_FINGERPRINT,
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

  it('speaks the pinned app-server protocol and supports server-request responses', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'astra-codex-protocol-'));
    try {
      const runtimeRoot = dirname(process.execPath);
      const artifact = process.execPath;
      const childScript = [
        "let buffer='';",
        "const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data',(chunk)=>{",
        'buffer+=chunk;',
        'const lines=buffer.split(/\\r?\\n/);',
        "buffer=lines.pop()??'';",
        'for(const line of lines){if(!line.trim())continue;const message=JSON.parse(line);',
        "send({method:'fixture.received',params:message});",
        "if(message.method==='initialize')send({id:message.id,result:{userAgent:'fixture',codexHome:'C:/astra',platformFamily:'windows',platformOs:'windows'}});",
        "else if(message.method==='thread/start')send({id:message.id,result:{thread:{id:'thread-1'},model:'astra-model',modelProvider:'astra'}});",
        "else if(message.method==='turn/start')send({id:message.id,result:{turn:{id:'turn-1'}}});",
        "else if(message.id===77)send({method:'fixture.responded'});",
        '}});',
      ].join('');
      const supervisor = new CodexRuntimeSupervisor({
        runtimeRoot,
        userDataPath: userData,
        runtimeApiBaseUrl: 'http://127.0.0.1:4317/runtime/codex/v1',
        runtimeQueryParams: { task_id: 'task-1', reservation_id: 'reservation-1' },
        manifest: {
          sourceSha: PINNED_CODEX_SOURCE_SHA,
          protocolFingerprint: CODEX_PROTOCOL_FINGERPRINT,
          adapterVersion: CODEX_ADAPTER_VERSION,
          version: 'fixture',
          artifactPath: basename(artifact),
          artifactSha256: await hash(artifact),
          args: ['-e', childScript],
        },
      });
      const session = await supervisor.start();
      const runtimeConfig = await readFile(
        join(userData, 'runtime', 'codex', 'config.toml'),
        'utf8',
      );
      expect(runtimeConfig).toContain(
        'query_params = { task_id = "task-1", reservation_id = "reservation-1" }',
      );
      const received: Array<Record<string, unknown>> = [];
      const unsubscribe = session.onEvent((event) => {
        if (event.method === 'fixture.received')
          received.push(event.params as Record<string, unknown>);
      });
      const client = new CodexAppServerClient(session);
      const initialized = await client.initialize();
      const thread = await client.startThread({
        cwd: 'C:\\workspace',
        model: 'astra-model',
        dynamicTools: ASTRA_CODEX_DYNAMIC_TOOLS,
      });
      const turn = await client.startTurn(thread.threadId, 'Inspect the project');

      expect(initialized.userAgent).toBe('fixture');
      expect(thread.threadId).toBe('thread-1');
      expect(turn.turnId).toBe('turn-1');
      expect(received).toHaveLength(4);
      expect(received.every((message) => !('jsonrpc' in message))).toBe(true);
      expect(received[0]).toMatchObject({ method: 'initialize' });
      expect(received[1]).toMatchObject({ method: 'initialized' });
      expect(received[2]).toMatchObject({
        method: 'thread/start',
        params: {
          dynamicTools: expect.arrayContaining([
            expect.objectContaining({ type: 'function', name: 'web_search' }),
          ]),
        },
      });
      expect(received[3]).toMatchObject({
        method: 'turn/start',
        params: { input: [{ type: 'text', text: 'Inspect the project', textElements: [] }] },
      });

      const response = new Promise<Record<string, unknown>>((resolveResponse) => {
        const stop = session.onEvent((event) => {
          if (event.method === 'fixture.responded') {
            stop();
            resolveResponse(event);
          }
        });
      });
      session.respond(77, { success: true });
      await expect(response).resolves.toMatchObject({ method: 'fixture.responded' });
      unsubscribe();
      await supervisor.stop();
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });
});
