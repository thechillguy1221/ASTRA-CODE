import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryCatalog } from '@astra/api';
import { AuthService, InMemoryAuthStore } from '@astra/auth';
import {
  BillingService,
  InMemoryBillingStore,
  InMemoryOrganizationBillingStore,
  OrganizationBillingService,
} from '@astra/billing';
import { createDefaultPlanCatalog } from '@astra/plans';
import { RemoteAccessService } from '@astra/remote-protocol';

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
        'x-astra-reservation-id': reservation.reservationId,
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

  it('does not allow a reservation for one model to authorize another model', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const catalog = createMemoryCatalog([
      {
        modelId: 'model-a',
        displayName: 'Model A',
        gatewayModelId: 'test/a',
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
      {
        modelId: 'model-b',
        displayName: 'Model B',
        gatewayModelId: 'test/b',
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
          yield { type: 'decision' as const, decision: { kind: 'finish' as const, summary: 'ok' } };
        },
      },
      developmentEntitlement: false,
    });
    const registration = await auth.register({
      email: 'model-binding@example.test',
      password: 'correct horse battery staple',
      device: { label: 'test', platform: 'win32', architecture: 'x64', appVersion: 'test' },
    });
    await auth.verifyEmail(registration.verificationToken);
    const login = await auth.login({
      email: 'model-binding@example.test',
      password: 'correct horse battery staple',
      device: { label: 'test', platform: 'win32', architecture: 'x64', appVersion: 'test' },
    });
    await billing.grantCredits({
      userId: login.user.id,
      amountCredits: '25',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'model-binding-grant',
      reason: 'test',
    });
    const reservation = await billing.reserveTask({
      userId: login.user.id,
      planId: login.user.planId,
      taskId: 'model-binding-task',
      modelId: 'model-a',
      mode: 'BUILD',
      amountCredits: '5',
      idempotencyKey: 'model-binding-reservation',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'x-astra-reservation-id': reservation.reservationId,
      },
      payload: {
        requestId: 'model-binding-request',
        taskId: 'model-binding-task',
        modelId: 'model-b',
        messages: [{ role: 'user', content: 'finish' }],
      },
    });
    expect(response.statusCode).toBe(409);
  });

  it('accepts an authorized organization reservation at the model boundary', async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({ store: authStore });
    const plans = createDefaultPlanCatalog();
    const billing = new BillingService({ store: new InMemoryBillingStore(), plans });
    const organizationBilling = new OrganizationBillingService({
      store: new InMemoryOrganizationBillingStore(),
      plans,
    });
    const remote = new RemoteAccessService();
    const catalog = createMemoryCatalog([
      {
        modelId: 'team-model',
        displayName: 'Team Model',
        gatewayModelId: 'test/team-model',
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
      organizationBilling,
      remote,
      catalog,
      gateway: {
        async *complete() {
          yield { type: 'decision' as const, decision: { kind: 'finish' as const, summary: 'ok' } };
        },
      },
      developmentEntitlement: false,
    });
    const registration = await auth.register({
      email: 'team-model@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await auth.verifyEmail(registration.verificationToken);
    const currentUser = await authStore.getUser(registration.user.id);
    await authStore.updateUser({ ...currentUser!, planId: 'TEAM' });
    const login = await auth.login({
      email: 'team-model@example.test',
      password: 'correct horse battery staple',
      device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    const device = await remote.registerDevice({
      userId: login.user.id,
      label: 'Team host',
      platform: 'win32',
      architecture: 'x64',
      publicKeyPem: 'test-public-key',
    });
    const organization = await remote.createOrganization({
      ownerUserId: login.user.id,
      displayName: 'Team Model Workspace',
      plan: {
        id: 'TEAM',
        seats: 5,
        monthlyCredits: '6000',
        pooledCredits: true,
        crossPersonRooms: true,
      },
    });
    const room = await remote.createRoom({
      actorUserId: login.user.id,
      organizationId: organization.id,
      hostDeviceId: device.id,
      name: 'Room',
      workspaceRootRelative: 'Projects/Room',
    });
    await organizationBilling.grantCredits({
      organizationId: organization.id,
      actorUserId: login.user.id,
      amountCredits: '25',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'team-model-grant',
      reason: 'Team monthly credits',
    });
    const reservation = await organizationBilling.reserveTask({
      organizationId: organization.id,
      actorUserId: login.user.id,
      roomId: room.id,
      hostDeviceId: device.id,
      planId: 'TEAM',
      taskId: 'team-model-task',
      modelId: 'team-model',
      mode: 'BUILD',
      amountCredits: '10',
      idempotencyKey: 'team-model-reservation',
      activeSeats: 1,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      headers: {
        authorization: `Bearer ${login.accessToken}`,
        'x-astra-reservation-id': reservation.reservationId,
      },
      payload: {
        requestId: 'team-model-request',
        taskId: 'team-model-task',
        agentSessionId: 'team-model-session',
        modelId: 'team-model',
        messages: [{ role: 'user', content: 'finish' }],
      },
    });
    expect(response.statusCode).toBe(200);
  });
});
