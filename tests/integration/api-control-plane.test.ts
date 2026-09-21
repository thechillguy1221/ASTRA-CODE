import { describe, expect, it } from 'vitest';
import { AuthService, InMemoryAuthStore } from '@astra/auth';
import {
  ControlPlaneService,
  InMemoryControlPlaneRepository,
  InMemoryInvalidationBus,
  type ControlPlaneModelSnapshot,
  type ControlPlanePlanSnapshot,
} from '@astra/control-plane';
import { createDefaultPlanCatalog } from '@astra/plans';
import { buildApi } from '@astra/api';

const now = '2026-01-01T00:00:00.000Z';

function planSnapshot(id = 'FREE'): ControlPlanePlanSnapshot {
  const plan = createDefaultPlanCatalog().get(id);
  return {
    ...plan,
    version: 1,
    status: 'ACTIVE',
    public: true,
    purchaseAvailable: true,
    effectiveFrom: now,
    effectiveTo: null,
    entitlements: {
      premiumModeAccess: plan.premiumModeAccess,
      pooledCredits: plan.pooledCredits,
      crossPersonRooms: plan.crossPersonRooms,
    },
    limits: {
      maxConcurrentJobs: { kind: 'NUMERIC', value: plan.maxConcurrentJobs },
      maxContextWindow: { kind: 'NUMERIC', value: plan.maxContextWindow },
    },
    updatedAt: now,
  };
}

function modelSnapshot(): ControlPlaneModelSnapshot {
  return {
    modelId: 'astra-test',
    displayName: 'Astra Test',
    gatewayModelId: 'provider/astra-test',
    providerSlug: 'provider',
    provider: 'Provider',
    enabled: true,
    visible: true,
    contextWindow: 128_000,
    capabilities: {
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsImageInput: false,
    },
    planAccess: ['*'],
    version: 1,
    status: 'AVAILABLE',
    maintenanceMessage: null,
    regionAvailability: ['GLOBAL'],
    updatedAt: now,
  };
}

async function authenticated(role: 'USER' | 'FINANCE' | 'SUPER_ADMIN') {
  const store = new InMemoryAuthStore();
  const auth = new AuthService({ store });
  const registration = await auth.register({
    email: `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'correct horse battery staple',
    device: {
      label: 'Test desktop',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.0',
    },
  });
  await auth.verifyEmail(registration.verificationToken);
  await store.updateUser({ ...(await store.getUser(registration.user.id))!, role });
  const session = await auth.login({
    email: registration.user.email,
    password: 'correct horse battery staple',
    device: {
      label: 'Test desktop',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.0',
    },
  });
  return { auth, store, token: session.accessToken };
}

function controlPlane() {
  const repository = new InMemoryControlPlaneRepository({
    plans: [planSnapshot()],
    models: [modelSnapshot()],
  });
  const service = new ControlPlaneService({
    repository,
    invalidationBus: new InMemoryInvalidationBus(),
  });
  return { repository, service };
}

describe('control-plane API boundary', () => {
  it('rejects ordinary users while allowing authenticated entitlement reads', async () => {
    const identity = await authenticated('USER');
    const { service } = controlPlane();
    const app = buildApi({ auth: identity.auth, controlPlane: service });

    const admin = await app.inject({
      method: 'GET',
      url: '/v1/admin/control-plane/plans',
      headers: { authorization: `Bearer ${identity.token}` },
    });
    expect(admin.statusCode).toBe(403);

    const entitlements = await app.inject({
      method: 'GET',
      url: '/v1/entitlements/me',
      headers: { authorization: `Bearer ${identity.token}` },
    });
    expect(entitlements.statusCode).toBe(200);
    expect(entitlements.json()).toMatchObject({ planId: 'FREE', version: 1 });
  });

  it('uses server role permissions, optimistic versions, and transaction-coupled audit', async () => {
    const identity = await authenticated('FINANCE');
    const { service } = controlPlane();
    const app = buildApi({ auth: identity.auth, controlPlane: service });
    const model = modelSnapshot();

    const modelUpdate = await app.inject({
      method: 'PUT',
      url: '/v1/admin/control-plane/models/astra-test',
      headers: { authorization: `Bearer ${identity.token}` },
      payload: {
        actorRole: 'SUPER_ADMIN',
        model: { ...model, version: 2, displayName: 'Tampered' },
        metadata: { expectedVersion: 1, reason: 'change model label', requestId: 'cp-model-1' },
      },
    });
    expect(modelUpdate.statusCode).toBe(403);

    const user = await identity.auth.getUserByEmail((await identity.auth.listUsers())[0]!.email);
    expect(user).toBeDefined();
    await identity.store.updateUser({ ...(await identity.store.getUser(user!.id))!, role: 'SUPER_ADMIN' });

    const plan = await service.getPlan('FREE');
    const planUpdate = await app.inject({
      method: 'PUT',
      url: '/v1/admin/control-plane/plans/FREE',
      headers: { authorization: `Bearer ${identity.token}` },
      payload: {
        actorRole: 'USER',
        plan: { ...plan, version: 2, displayName: 'Free Controlled' },
        metadata: { expectedVersion: 1, reason: 'update public plan', requestId: 'cp-plan-1' },
      },
    });
    expect(planUpdate.statusCode).toBe(200);
    expect(planUpdate.json().plan.version).toBe(2);

    const stale = await app.inject({
      method: 'PUT',
      url: '/v1/admin/control-plane/plans/FREE',
      headers: { authorization: `Bearer ${identity.token}` },
      payload: {
        plan: { ...plan, version: 3 },
        metadata: { expectedVersion: 1, reason: 'stale write', requestId: 'cp-plan-stale' },
      },
    });
    expect(stale.statusCode).toBe(409);

    const audit = await app.inject({
      method: 'GET',
      url: '/v1/admin/control-plane/audit',
      headers: { authorization: `Bearer ${identity.token}` },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().entries).toHaveLength(1);
    expect(audit.json().entries[0]).toMatchObject({
      action: 'PLAN_UPDATED',
      reason: 'update public plan',
      requestId: 'cp-plan-1',
    });
  });

  it('fails closed when the control-plane read is unavailable', async () => {
    const identity = await authenticated('USER');
    const { repository, service } = controlPlane();
    repository.failReads = true;
    const app = buildApi({ auth: identity.auth, controlPlane: service });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/entitlements/me',
      headers: { authorization: `Bearer ${identity.token}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('CONTROL_PLANE_UNAVAILABLE');
  });
});
