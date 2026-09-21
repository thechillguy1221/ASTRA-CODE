import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRelayGrant, RemoteRelayBroker, WebSocketRelayServer } from '@astra/remote-protocol';
import { WebSocket, type RawData } from 'ws';

type RelayFrame = { type?: string; messageId?: string; [key: string]: unknown };

function waitForMessage(
  socket: WebSocket,
  predicate: (value: RelayFrame) => boolean,
): Promise<RelayFrame> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: RawData): void => {
      let value: unknown;
      try {
        value = JSON.parse(raw.toString()) as unknown;
      } catch {
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      if (!predicate(value as RelayFrame)) return;
      socket.off('error', onError);
      socket.off('message', onMessage);
      resolve(value);
    };
    const onError = (error: Error): void => {
      socket.off('message', onMessage);
      reject(error);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

async function openRelaySocket(url: string, token: string, role: 'HOST' | 'CLIENT') {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'relay.auth', token, role }));
  await waitForMessage(socket, (value) => value?.type === 'relay.ready');
  return socket;
}

describe('WebSocket relay transport', () => {
  it('authenticates both peers and forwards only broker-approved messages', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const broker = new RemoteRelayBroker('relay-secret');
    const relay = new WebSocketRelayServer(broker, {
      requireTls: false,
      heartbeatTimeoutMs: 5_000,
      flushIntervalMs: 5,
    });
    relay.attach(server);
    const sessionId = randomUUID();
    const hostGrant = createRelayGrant(
      {
        sessionId,
        userId: 'user-1',
        deviceId: 'device-host',
        roomId: null,
        role: 'HOST',
        permissions: [],
        ttlMs: 5_000,
      },
      'relay-secret',
    );
    const clientGrant = createRelayGrant(
      {
        sessionId,
        userId: 'user-1',
        deviceId: 'device-client',
        roomId: null,
        role: 'CLIENT',
        permissions: ['agent.prompt'],
        ttlMs: 5_000,
      },
      'relay-secret',
    );
    const url = `ws://127.0.0.1:${address.port}/v1/relay`;
    const host = await openRelaySocket(url, hostGrant.token, 'HOST');
    const client = await openRelaySocket(url, clientGrant.token, 'CLIENT');
    const prompt = {
      messageId: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      type: 'prompt.submit' as const,
      payload: {
        sessionId,
        prompt: 'Run the bounded test task',
        modelId: 'approved-model',
      },
    };
    const received = waitForMessage(host, (value) => value.messageId === prompt.messageId);
    client.send(JSON.stringify(prompt));
    await expect(received).resolves.toMatchObject({ type: 'prompt.submit' });

    client.close();
    host.close();
    await relay.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
