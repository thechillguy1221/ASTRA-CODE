import { describe, expect, it } from 'vitest';
import { createRelayGrant, RelayError, RemoteRelayBroker } from '@astra/remote-protocol';

const SECRET = 'relay-test-secret';

function grants(now: Date) {
  const base = {
    sessionId: 'session-1',
    userId: 'alice',
    deviceId: 'device-1',
    roomId: null,
    permissions: ['agent.prompt', 'terminal.run'],
    ttlMs: 60_000,
  } as const;
  return {
    host: createRelayGrant({ ...base, role: 'HOST' }, SECRET, now),
    client: createRelayGrant({ ...base, role: 'CLIENT' }, SECRET, now),
  };
}

describe('authenticated remote relay core', () => {
  it('pairs host/client grants, validates permissions, and delivers bounded messages', () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    const broker = new RemoteRelayBroker(SECRET, { now: () => now });
    const { host, client } = grants(now);
    const hostConnection = broker.connect(host.token, 'HOST');
    const clientConnection = broker.connect(client.token, 'CLIENT');
    const message = {
      type: 'prompt.submit',
      messageId: 'f4e5d2a2-c7f4-4d91-9151-5960fbe0aa11',
      sessionId: 'session-1',
      timestamp: now.toISOString(),
      payload: { sessionId: 'session-1', prompt: 'Run the bounded task', modelId: 'model-1' },
    } as const;
    broker.send(clientConnection.connectionId, message);
    expect(broker.receive(hostConnection.connectionId)).toEqual([message]);
    expect(() => broker.send(clientConnection.connectionId, message)).toThrowError(
      expect.objectContaining({ code: 'REPLAYED_MESSAGE' }),
    );
  });

  it('denies a client grant without the action permission', () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    const broker = new RemoteRelayBroker(SECRET, { now: () => now });
    const grant = createRelayGrant(
      {
        sessionId: 'session-2',
        userId: 'bob',
        deviceId: 'device-2',
        roomId: 'room-1',
        role: 'CLIENT',
        permissions: ['room.view'],
        ttlMs: 60_000,
      },
      SECRET,
      now,
    );
    const connection = broker.connect(grant.token, 'CLIENT');
    const message = {
      type: 'prompt.submit',
      messageId: '311d4ed6-5d85-4678-b1a2-bb4bd6df7783',
      sessionId: 'session-2',
      timestamp: now.toISOString(),
      payload: { sessionId: 'session-2', prompt: 'blocked', modelId: 'model-1' },
    } as const;
    expect(() => broker.send(connection.connectionId, message)).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    );
  });

  it('immediately revokes an active Room member connection', () => {
    const now = new Date('2026-09-20T00:00:00.000Z');
    const broker = new RemoteRelayBroker(SECRET, { now: () => now });
    const grant = createRelayGrant(
      {
        sessionId: 'room-session-member',
        userId: 'bob',
        deviceId: 'device-host',
        roomId: 'room-1',
        role: 'CLIENT',
        permissions: ['room.view', 'agent.prompt'],
        ttlMs: 60_000,
      },
      SECRET,
      now,
    );
    const connection = broker.connect(grant.token, 'CLIENT');
    broker.revokeRoomMember('room-1', 'bob');
    expect(() => broker.heartbeat(connection.connectionId)).toThrowError(
      expect.objectContaining({ code: 'NOT_CONNECTED' }),
    );
  });

  it('revokes a session and expires grants without exposing transport success', () => {
    let now = new Date('2026-09-20T00:00:00.000Z');
    const broker = new RemoteRelayBroker(SECRET, { now: () => now });
    const { host } = grants(now);
    const connection = broker.connect(host.token, 'HOST');
    broker.revokeSession('session-1');
    expect(() => broker.heartbeat(connection.connectionId)).toThrowError(
      expect.objectContaining({ code: 'NOT_CONNECTED' }),
    );

    const fresh = createRelayGrant(
      {
        sessionId: 'session-3',
        userId: 'alice',
        deviceId: 'device-1',
        roomId: null,
        role: 'HOST',
        permissions: [],
        ttlMs: 1,
      },
      SECRET,
      now,
    );
    now = new Date(now.getTime() + 2);
    expect(() => broker.connect(fresh.token, 'HOST')).toThrowError(
      expect.objectContaining({ code: 'GRANT_EXPIRED' }),
    );
    expect(RelayError).toBeDefined();
  });
});
