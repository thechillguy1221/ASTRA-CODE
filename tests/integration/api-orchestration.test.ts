import { describe, expect, it } from 'vitest';
import { AuthService, InMemoryAuthStore } from '@astra/auth';
import { buildApi } from '@astra/api';
import { InMemoryPlatformRecordStore, PlatformOrchestrationService } from '@astra/orchestration';

async function createSession(auth: AuthService, email: string) {
  const registration = await auth.register({
    email,
    password: 'correct horse battery staple',
    device: { label: 'Test', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
  });
  await auth.verifyEmail(registration.verificationToken);
  const session = await auth.login({
    email,
    password: 'correct horse battery staple',
    device: { label: 'Test', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
  });
  return { userId: registration.user.id, token: session.accessToken };
}

describe('orchestration API boundary', () => {
  it('allows configured browser origins and rejects unknown preflight origins', async () => {
    const allowed = buildApi({ allowedOrigins: ['https://app.example.test'] });
    const allowedResponse = await allowed.inject({
      method: 'OPTIONS',
      url: '/v1/pricing',
      headers: { origin: 'https://app.example.test', 'access-control-request-method': 'GET' },
    });
    expect(allowedResponse.statusCode).toBe(204);
    expect(allowedResponse.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(allowedResponse.headers['access-control-allow-credentials']).toBe('true');

    const deniedResponse = await allowed.inject({
      method: 'OPTIONS',
      url: '/v1/pricing',
      headers: { origin: 'https://attacker.example.test', 'access-control-request-method': 'GET' },
    });
    expect(deniedResponse.statusCode).toBe(403);
    expect(deniedResponse.json()).toEqual({ error: 'CORS_ORIGIN_DENIED' });
  });

  it('creates a spec, persists a task graph, and hides it from another user', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const owner = await createSession(auth, 'owner-orchestration@example.test');
    const other = await createSession(auth, 'other-orchestration@example.test');
    const orchestration = new PlatformOrchestrationService({
      store: new InMemoryPlatformRecordStore(),
    });
    const app = buildApi({ auth, orchestration });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/specs',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        title: 'Ship feature',
        slug: 'ship-feature',
        objective: 'Ship the feature safely',
      },
    });
    expect(created.statusCode).toBe(201);
    const specId = created.json().spec.id as string;

    const tasks = await app.inject({
      method: 'POST',
      url: `/v1/specs/${specId}/tasks`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        tasks: [
          {
            id: 'backend',
            title: 'Backend',
            description: 'Implement API',
            ownerAgentRole: 'BACKEND',
            dependencies: [],
            affectedAreas: ['apps/api'],
            complexity: 'MEDIUM',
            budget: {
              maxCredits: '5',
              maxModelCalls: 2,
              maxParallelAgents: 1,
              maxWallTimeMs: 30_000,
            },
          },
          {
            id: 'tests',
            title: 'Tests',
            description: 'Verify API',
            ownerAgentRole: 'TEST',
            dependencies: ['backend'],
            affectedAreas: ['tests'],
            complexity: 'LOW',
            budget: {
              maxCredits: '2',
              maxModelCalls: 1,
              maxParallelAgents: 1,
              maxWallTimeMs: 30_000,
            },
          },
        ],
      },
    });
    expect(tasks.statusCode).toBe(201);

    const ready = await app.inject({
      method: 'GET',
      url: `/v1/specs/${specId}/ready`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().tasks.map((task: { id: string }) => task.id)).toEqual(['backend']);
    const backendTaskId = ready.json().tasks[0].id as string;

    const claimed = await app.inject({
      method: 'POST',
      url: `/v1/specs/${specId}/tasks/${backendTaskId}/claim`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { agentId: 'agent-backend', leaseMs: 30_000 },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().task.status).toBe('RUNNING');

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/specs/${specId}/tasks/${backendTaskId}/complete`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { agentId: 'agent-backend', status: 'SUCCEEDED' },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().task.status).toBe('SUCCEEDED');

    const nextReady = await app.inject({
      method: 'GET',
      url: `/v1/specs/${specId}/ready`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(nextReady.statusCode).toBe(200);
    expect(nextReady.json().tasks.map((task: { id: string }) => task.id)).toEqual(['tests']);

    const crossUserRead = await app.inject({
      method: 'GET',
      url: `/v1/specs/${specId}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(crossUserRead.statusCode).toBe(404);
    expect(crossUserRead.json()).toEqual({ error: 'SPEC_NOT_FOUND' });

    const crossUserMutation = await app.inject({
      method: 'POST',
      url: `/v1/specs/${specId}/tasks`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: {
        tasks: [
          {
            id: 'intruder',
            title: 'Intruder',
            description: 'Should not be accepted',
            ownerAgentRole: 'TEST',
            dependencies: [],
            affectedAreas: [],
            complexity: 'LOW',
            budget: {
              maxCredits: '1',
              maxModelCalls: 1,
              maxParallelAgents: 1,
              maxWallTimeMs: 30_000,
            },
          },
        ],
      },
    });
    expect(crossUserMutation.statusCode).toBe(404);
    expect(crossUserMutation.json()).toEqual({ error: 'SPEC_NOT_FOUND' });
  });
});
