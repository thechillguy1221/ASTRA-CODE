import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryCatalog } from '@lyntar/api';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import { BillingService, InMemoryBillingStore } from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';

describe('authenticated model reservation boundary', () => {
  it('does not let an authenticated task call the model without a reservation', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const catalog = createMemoryCatalog([
      {
        modelId: 'approved-core',
        displayName: 'Core',
        gatewayModelId: 'test/core',
        providerSlug: 'test',
        enabled: true,
        capabilities: {
          supportsTools: true,
          supportsStreaming: true,
          supportsReasoning: false,
          supportsStructuredOutput: true,
          supportsImageInput: false,
        },
      },
    ]);
    const app = buildApi({
      auth,
      billing,
      catalog,
      gateway: {
        async *complete() {
          yield {
            type: 'decision' as const,
            decision: { kind: 'finish' as const, summary: 'Verified' },
          };
        },
      },
      exposeDevelopmentTokens: true,
      developmentEntitlement: false,
    });
    const registration = await auth.register({
      email: 'model-user@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await auth.verifyEmail(registration.verificationToken);
    const login = await auth.login({
      email: 'model-user@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await billing.grantCredits({
      userId: login.user.id,
      amountCredits: '50',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'model-grant',
      reason: 'test',
    });
    const body = {
      requestId: 'request-reservation',
      taskId: 'task-reservation',
      agentSessionId: 'session-reservation',
      modelId: 'approved-core',
      messages: [{ role: 'user', content: 'Finish' }],
    };
    const withoutReservation = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: body,
    });
    expect(withoutReservation.statusCode).toBe(409);
    const reservation = await billing.reserveTask({
      userId: login.user.id,
      planId: login.user.planId,
      taskId: body.taskId,
      modelId: body.modelId,
      mode: 'BUILD',
      amountCredits: '10',
      idempotencyKey: 'model-reservation',
    });
    const withReservation = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'x-lyntar-reservation-id': reservation.reservationId,
      },
      payload: body,
    });
    expect(withReservation.statusCode).toBe(200);
  });

  it('uses server model plan access for catalog IDs that are not desktop constants', async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({ store: authStore });
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const catalog = createMemoryCatalog([
      {
        modelId: 'gateway-live-model',
        displayName: 'Approved live model',
        gatewayModelId: 'provider/live-model',
        providerSlug: 'gateway',
        enabled: true,
        planAccess: ['STUDENT'],
        capabilities: {
          supportsTools: true,
          supportsStreaming: true,
          supportsReasoning: true,
          supportsStructuredOutput: true,
          supportsImageInput: false,
        },
      },
    ]);
    const app = buildApi({ auth, billing, catalog, developmentEntitlement: false });
    const registration = await auth.register({
      email: 'model-plan@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await auth.verifyEmail(registration.verificationToken);
    await authStore.updateUser({
      ...(await authStore.getUser(registration.user.id))!,
      planId: 'STUDENT',
    });
    const login = await auth.login({
      email: 'model-plan@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await billing.grantCredits({
      userId: login.user.id,
      amountCredits: '50',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'model-plan-grant',
      reason: 'test',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/billing/reservations',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: {
        taskId: 'task-model-plan',
        modelId: 'gateway-live-model',
        mode: 'BUILD',
        amountCredits: '10',
        idempotencyKey: 'model-plan-reservation',
      },
    });
    expect(response.statusCode).toBe(201);
  });
});
