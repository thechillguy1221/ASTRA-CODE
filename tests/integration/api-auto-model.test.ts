import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryCatalog } from '@lyntar/api';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import { BillingService, InMemoryBillingStore } from '@lyntar/billing';
import { AUTO_MODEL_ID } from '@lyntar/contracts';
import { createDefaultPlanCatalog } from '@lyntar/plans';

const model = (modelId: string, displayName: string, recommended = false) => ({
  modelId,
  displayName,
  gatewayModelId: `provider/${modelId}`,
  providerSlug: 'provider',
  recommended,
  enabled: true,
  visible: true,
  capabilities: {
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: false,
    supportsStructuredOutput: true,
    supportsImageInput: false,
  },
  costMetadata: { inputUsdPer1k: 0.001, outputUsdPer1k: 0.002 },
});

describe('server-authoritative Auto model selection', () => {
  it('routes AUTO to a real catalog model and discloses the selection', async () => {
    let gatewayModelId = '';
    const app = buildApi({
      catalog: createMemoryCatalog([model('balanced', 'Balanced model', true)]),
      gateway: {
        async *complete(request) {
          gatewayModelId = request.gatewayModelId;
          yield {
            type: 'decision' as const,
            decision: { kind: 'message' as const, summary: 'Routed' },
          };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      payload: {
        requestId: 'auto-request',
        taskId: 'auto-task',
        modelId: AUTO_MODEL_ID,
        messages: [{ role: 'user', content: 'Inspect the auth flow' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(gatewayModelId).toBe('provider/balanced');
    expect(response.json().selectedModelId).toBe('balanced');
    expect(response.json().selectedModelDisplayName).toBe('Balanced model');
  });

  it('binds an authenticated AUTO reservation to the selected catalog model', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    let gatewayModelId = '';
    const app = buildApi({
      auth,
      billing,
      catalog: createMemoryCatalog([
        model('cheap', 'Save credits'),
        model('recommended', 'Recommended', true),
      ]),
      gateway: {
        async *complete(request) {
          gatewayModelId = request.gatewayModelId;
          yield {
            type: 'decision' as const,
            decision: { kind: 'finish' as const, summary: 'Verified' },
          };
        },
      },
      developmentEntitlement: false,
    });
    const registration = await auth.register({
      email: 'auto@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await auth.verifyEmail(registration.verificationToken);
    const login = await auth.login({
      email: 'auto@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await billing.grantCredits({
      userId: login.user.id,
      amountCredits: '25',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'auto-grant',
      reason: 'test',
    });

    const reservationResponse = await app.inject({
      method: 'POST',
      url: '/v1/billing/reservations',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: {
        taskId: 'auto-task-authenticated',
        modelId: AUTO_MODEL_ID,
        mode: 'BUILD',
        amountCredits: '5',
        idempotencyKey: 'auto-reservation',
      },
    });
    expect(reservationResponse.statusCode).toBe(201);
    const reservation = reservationResponse.json().reservation;
    expect(reservation.modelId).toBe('recommended');

    const modelResponse = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'x-lyntar-reservation-id': reservation.reservationId,
      },
      payload: {
        requestId: 'auto-request-authenticated',
        taskId: 'auto-task-authenticated',
        modelId: AUTO_MODEL_ID,
        messages: [{ role: 'user', content: 'Finish the task' }],
      },
    });
    expect(modelResponse.statusCode).toBe(200);
    expect(gatewayModelId).toBe('provider/recommended');
    expect(modelResponse.json().selectedModelId).toBe('recommended');
  });
});
