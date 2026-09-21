import { describe, expect, it } from 'vitest';
import { AuthService, InMemoryAuthStore } from '@astra/auth';
import {
  ControlPlaneService,
  InMemoryControlPlaneRepository,
  InMemoryInvalidationBus,
  type ControlPlaneModelSnapshot,
  type ControlPlanePlanSnapshot,
} from '@astra/control-plane';
import { BillingService, InMemoryBillingStore } from '@astra/billing';
import { createMemoryCatalog, createMemoryReceiptStore } from '@astra/db';
import { createDefaultPlanCatalog } from '@astra/plans';
import { buildApi } from '@astra/api';

const now = '2026-01-01T00:00:00.000Z';

const plan: ControlPlanePlanSnapshot = {
  ...createDefaultPlanCatalog().get('FREE'),
  version: 1,
  status: 'ACTIVE',
  public: true,
  purchaseAvailable: true,
  effectiveFrom: now,
  effectiveTo: null,
  entitlements: { modelAccess: true },
  limits: {},
  updatedAt: now,
};

function model(
  status: ControlPlaneModelSnapshot['status'] = 'AVAILABLE',
): ControlPlaneModelSnapshot {
  return {
    modelId: 'server-model',
    displayName: 'Server Model',
    gatewayModelId: 'provider/server-model',
    providerSlug: 'provider',
    enabled: true,
    visible: true,
    capabilities: {
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      supportsImageInput: false,
    },
    planAccess: ['*'],
    version: 1,
    status,
    maintenanceMessage: status === 'MAINTENANCE' ? 'planned maintenance' : null,
    regionAvailability: ['GLOBAL'],
    updatedAt: now,
  };
}

async function fixture(status: ControlPlaneModelSnapshot['status'] = 'AVAILABLE') {
  const authStore = new InMemoryAuthStore();
  const auth = new AuthService({ store: authStore });
  const registration = await auth.register({
    email: `model-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'correct horse battery staple',
    device: { label: 'Test', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
  });
  await auth.verifyEmail(registration.verificationToken);
  const login = await auth.login({
    email: registration.user.email,
    password: 'correct horse battery staple',
    device: { label: 'Test', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
  });
  const repository = new InMemoryControlPlaneRepository({ plans: [plan], models: [model(status)] });
  const controlPlane = new ControlPlaneService({
    repository,
    invalidationBus: new InMemoryInvalidationBus(),
  });
  const billing = new BillingService({
    store: new InMemoryBillingStore(),
    plans: createDefaultPlanCatalog(),
  });
  await billing.grantCredits({
    userId: login.user.id,
    amountCredits: '25',
    transactionType: 'PROMO_CREDIT',
    idempotencyKey: 'model-policy-grant',
    reason: 'model policy test',
  });
  const reservation = await billing.reserveTask({
    userId: login.user.id,
    planId: 'FREE',
    taskId: 'model-policy-task',
    modelId: 'server-model',
    mode: 'BUILD',
    amountCredits: '1',
    idempotencyKey: 'model-policy-reservation',
  });
  const catalog = createMemoryCatalog([{ ...model(status), status: undefined } as never]);
  const app = buildApi({
    auth,
    billing,
    catalog,
    receipts: createMemoryReceiptStore(),
    controlPlane,
    developmentEntitlement: false,
    gateway: {
      async *complete() {
        yield { type: 'decision' as const, decision: { kind: 'finish' as const, summary: 'ok' } };
      },
    },
  });
  return { app, login, repository, reservation };
}

describe('authoritative model policy at execution', () => {
  it('rejects a model in maintenance before gateway execution', async () => {
    const { app, login, reservation } = await fixture('MAINTENANCE');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'x-astra-reservation-id': reservation.reservationId,
      },
      payload: {
        requestId: 'model-policy-request',
        taskId: 'model-policy-task',
        modelId: 'server-model',
        messages: [{ role: 'user', content: 'run' }],
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('MODEL_POLICY_DENIED');
  });

  it('fails closed when authoritative model policy cannot be read', async () => {
    const { app, login, repository, reservation } = await fixture();
    repository.failReads = true;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'x-astra-reservation-id': reservation.reservationId,
      },
      payload: {
        requestId: 'model-policy-request-unavailable',
        taskId: 'model-policy-task',
        modelId: 'server-model',
        messages: [{ role: 'user', content: 'run' }],
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('CONTROL_PLANE_UNAVAILABLE');
  });
});
