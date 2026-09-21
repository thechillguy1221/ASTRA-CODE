import { describe, expect, it, vi } from 'vitest';
import { AuthService, InMemoryAuthStore } from '@astra/auth';
import { buildApi } from '@astra/api';
import {
  InMemoryWebResearchUsageStore,
  WebResearchService,
  type WebSearchProvider,
} from '@astra/web-research';

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
  return (Array.isArray(cookies) ? cookies : [cookies])
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

function createResearchService(usageStore = new InMemoryWebResearchUsageStore()) {
  const provider: WebSearchProvider = {
    id: 'test-search-provider',
    search: vi.fn(async () => ({
      results: [
        {
          id: 'source-1',
          title: 'Astra web research',
          url: 'https://docs.example.test/guide',
          snippet: 'Authoritative documentation',
        },
      ],
    })),
  };
  const service = new WebResearchService({
    provider,
    usageStore,
    fetchImpl: vi.fn(
      async () =>
        new Response('<title>Guide</title><p>Untrusted reference content</p>', {
          headers: { 'content-type': 'text/html' },
        }),
    ),
    dnsLookup: async () => ['93.184.216.34'],
  });
  return { service, provider, usageStore };
}

describe('Astra Web Search and Web Fetch API', () => {
  it('returns an explicit unavailable result when the API has no live provider', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const app = buildApi({ auth, exposeDevelopmentTokens: true });
    const cookie = await registerAndLogin(app, 'unavailable-web@example.test');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/web/search',
      headers: { cookie },
      payload: { taskId: 'unavailable-task', query: 'current information' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'WEB_SEARCH_UNAVAILABLE' });
  });

  it('authorizes personal search/fetch and returns normalized provenance with personal context', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const { service, usageStore } = createResearchService();
    const app = buildApi({ auth, exposeDevelopmentTokens: true, webResearch: service });
    const cookie = await registerAndLogin(app, 'personal-web@example.test');

    const search = await app.inject({
      method: 'POST',
      url: '/v1/web/search',
      headers: { cookie },
      payload: {
        taskId: 'personal-task-1',
        query: 'Astra web research',
        walletId: 'attacker-selected-wallet',
      },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({
      billingContext: { kind: 'personal' },
      provider: 'test-search-provider',
      results: [{ id: 'source-1', domain: 'docs.example.test' }],
    });
    expect(search.json().walletId).toBeUndefined();

    const fetched = await app.inject({
      method: 'POST',
      url: '/v1/web/fetch',
      headers: { cookie },
      payload: { taskId: 'personal-task-1', url: 'https://docs.example.test/guide' },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      billingContext: { kind: 'personal' },
      untrusted: true,
      source: { domain: 'docs.example.test' },
    });
    expect(await usageStore.listByTask('personal-task-1')).toHaveLength(2);
    expect((await usageStore.listByTask('personal-task-1'))[0]?.billingContext).toMatchObject({
      kind: 'personal',
    });
  });

  it('uses the Room organization context and denies Viewer web execution', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const { service, usageStore } = createResearchService();
    const app = buildApi({ auth, exposeDevelopmentTokens: true, webResearch: service });
    const alice = await registerAndLogin(app, 'alice-web-room@example.test');
    const bob = await registerAndLogin(app, 'bob-web-room@example.test');
    const aliceUser = (await auth.listUsers()).find(
      (user) => user.email === 'alice-web-room@example.test',
    );
    if (!aliceUser) throw new Error('Alice was not created');
    await auth.assignPlan(aliceUser.id, 'TEAM');

    const device = await app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      headers: { cookie: alice },
      payload: {
        label: 'Alice host',
        platform: 'win32',
        architecture: 'x64',
        publicKeyPem: 'alice-web-room-key',
      },
    });
    const organization = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { cookie: alice },
      payload: { displayName: 'Astra Web Team' },
    });
    const room = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organization.json().organization.id}/rooms`,
      headers: { cookie: alice },
      payload: {
        name: 'Research Room',
        hostDeviceId: device.json().device.id,
        workspaceRootRelative: 'research-project',
      },
    });
    const roomId = room.json().room.id as string;
    const invitation = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/invitations`,
      headers: { cookie: alice },
      payload: { email: 'bob-web-room@example.test', idempotencyKey: 'web-room-invite' },
    });
    const redeemed = await app.inject({
      method: 'POST',
      url: '/v1/rooms/invitations/redeem',
      headers: { cookie: bob },
      payload: { token: invitation.json().token },
    });
    expect(redeemed.statusCode).toBe(200);
    const bobUserId = redeemed.json().member.userId as string;

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/web/search',
      headers: { cookie: bob },
      payload: { taskId: 'room-task-1', roomId, query: 'team docs' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().billingContext).toMatchObject({
      kind: 'organization',
      organizationId: organization.json().organization.id,
      roomId,
    });
    expect((await usageStore.listByTask('room-task-1'))[0]?.billingContext).toMatchObject({
      kind: 'organization',
      organizationId: organization.json().organization.id,
      roomId,
      actorUserId: bobUserId,
    });

    const role = await app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/members/${bobUserId}/role`,
      headers: { cookie: alice },
      payload: { role: 'VIEWER' },
    });
    expect(role.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/web/fetch',
      headers: { cookie: bob },
      payload: { taskId: 'viewer-task', roomId, url: 'https://docs.example.test/guide' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'PERMISSION_DENIED' });
  });
});
