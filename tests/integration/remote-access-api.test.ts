import { describe, expect, it } from 'vitest';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import { buildApi } from '@lyntar/api';
import { RemoteRelayBroker, verifyRelayGrant } from '@lyntar/remote-protocol';

async function registerAndLogin(app: ReturnType<typeof buildApi>, email: string): Promise<string> {
  const registered = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email,
      password: 'correct horse battery staple',
      device: {
        label: `${email} browser`,
        platform: 'web',
        architecture: 'browser',
        appVersion: 'test',
      },
    },
  });
  expect(registered.statusCode).toBe(201);
  const verified = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: { token: registered.json().verificationToken },
  });
  expect(verified.statusCode).toBe(204);
  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: {
      email,
      password: 'correct horse battery staple',
      device: {
        label: `${email} browser`,
        platform: 'web',
        architecture: 'browser',
        appVersion: 'test',
      },
    },
  });
  expect(login.statusCode).toBe(200);
  const cookies = login.headers['set-cookie'];
  if (!cookies) throw new Error('test login did not issue a session cookie');
  const cookieHeader = (Array.isArray(cookies) ? cookies : [cookies])
    .map((value) => value.split(';', 1)[0])
    .join('; ');
  return cookieHeader;
}

describe('authenticated personal devices and Room API', () => {
  it('routes a Team invitation through server authorization and revokes suspended access', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const relaySecret = 'relay-secret-for-tests-012345678901234567890123';
    const relayBroker = new RemoteRelayBroker(relaySecret);
    const app = buildApi({
      auth,
      exposeDevelopmentTokens: true,
      relaySecret,
      relayBroker,
    });
    const alice = await registerAndLogin(app, 'alice-room@example.test');
    const bob = await registerAndLogin(app, 'bob-room@example.test');
    const aliceUser = (await auth.listUsers()).find(
      (user) => user.email === 'alice-room@example.test',
    );
    if (!aliceUser) throw new Error('Alice was not created');
    await auth.assignPlan(aliceUser.id, 'TEAM');

    const deviceResponse = await app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      headers: { cookie: alice },
      payload: {
        label: 'Alice host',
        platform: 'win32',
        architecture: 'x64',
        publicKeyPem: 'alice-room-key',
      },
    });
    expect(deviceResponse.statusCode).toBe(201);
    const deviceId = deviceResponse.json().device.id as string;

    const organizationResponse = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { cookie: alice },
      payload: { displayName: 'Astra Team', planId: 'TEAM' },
    });
    expect(organizationResponse.statusCode).toBe(201);
    const organizationId = organizationResponse.json().organization.id as string;

    const roomResponse = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/rooms`,
      headers: { cookie: alice },
      payload: {
        name: 'Website',
        hostDeviceId: deviceId,
        workspaceRootRelative: 'workspace-website',
      },
    });
    expect(roomResponse.statusCode).toBe(201);
    const roomId = roomResponse.json().room.id as string;

    const hostGrant = await app.inject({
      method: 'POST',
      url: '/v1/relay/grants',
      headers: { cookie: alice },
      payload: { deviceId, roomId, role: 'HOST' },
    });
    expect(hostGrant.statusCode).toBe(200);
    expect(
      verifyRelayGrant(
        hostGrant.json().token as string,
        'relay-secret-for-tests-012345678901234567890123',
      ),
    ).toMatchObject({ role: 'HOST', deviceId, roomId });

    const invitationResponse = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/invitations`,
      headers: { cookie: alice },
      payload: { email: 'bob-room@example.test', idempotencyKey: 'room-invite-1' },
    });
    expect(invitationResponse.statusCode).toBe(201);
    const invitationToken = invitationResponse.json().token as string;

    const redeemed = await app.inject({
      method: 'POST',
      url: '/v1/rooms/invitations/redeem',
      headers: { cookie: bob },
      payload: { token: invitationToken },
    });
    expect(redeemed.statusCode).toBe(200);

    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/authorize/agent.prompt`,
      headers: { cookie: bob },
    });
    expect(allowed.statusCode).toBe(200);

    const clientGrant = await app.inject({
      method: 'POST',
      url: '/v1/relay/grants',
      headers: { cookie: bob },
      payload: {
        deviceId,
        roomId,
        role: 'CLIENT',
        permissions: ['room.view', 'agent.prompt'],
      },
    });
    expect(clientGrant.statusCode).toBe(200);
    expect(verifyRelayGrant(clientGrant.json().token as string, relaySecret)).toMatchObject({
      role: 'CLIENT',
      deviceId,
      roomId,
      permissions: ['room.view', 'agent.prompt'],
    });
    const clientConnection = relayBroker.connect(clientGrant.json().token as string, 'CLIENT');

    const role = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/members/${redeemed.json().member.userId}/role`,
      headers: { cookie: alice },
      payload: { role: 'VIEWER' },
    });
    expect(role.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/authorize/agent.prompt`,
      headers: { cookie: bob },
    });
    expect(denied.statusCode).toBe(403);

    const deniedGrant = await app.inject({
      method: 'POST',
      url: '/v1/relay/grants',
      headers: { cookie: bob },
      payload: { deviceId, roomId, role: 'CLIENT', permissions: ['agent.prompt'] },
    });
    expect(deniedGrant.statusCode).toBe(403);

    const restoredRole = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/members/${redeemed.json().member.userId}/role`,
      headers: { cookie: alice },
      payload: { role: 'AGENT_USER' },
    });
    expect(restoredRole.statusCode).toBe(200);
    const suspended = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/members/${redeemed.json().member.userId}/suspend`,
      headers: { cookie: alice },
    });
    expect(suspended.statusCode).toBe(204);
    expect(() => relayBroker.heartbeat(clientConnection.connectionId)).toThrowError(
      expect.objectContaining({ code: 'NOT_CONNECTED' }),
    );
    const suspendedAttempt = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/authorize/room.view`,
      headers: { cookie: bob },
    });
    expect(suspendedAttempt.statusCode).toBe(403);
  });
});
