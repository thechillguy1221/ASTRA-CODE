import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryCatalog, createMemoryReceiptStore } from '@lyntar/api';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import { BillingService, InMemoryBillingStore } from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';

describe('Codex runtime API boundary', () => {
  it('issues a task-bound runtime token and streams through the server gateway', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const receipts = createMemoryReceiptStore();
    const catalog = createMemoryCatalog([
      {
        modelId: 'approved-core',
        displayName: 'Core',
        gatewayModelId: 'provider/core',
        providerSlug: 'provider',
        enabled: true,
        costMetadata: { inputUsdPer1k: 0.01, outputUsdPer1k: 0.02 },
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
      receipts,
      runtimeTokenSecret: 'runtime-test-secret-with-at-least-32-bytes',
      exposeDevelopmentTokens: true,
      responsesGateway: {
        async *stream() {
          yield {
            event: 'response.created',
            data: { type: 'response.created', response: { id: 'response-1' } },
          };
          yield {
            event: 'response.output_text.delta',
            data: { type: 'response.output_text.delta', delta: 'hello' },
          };
          yield {
            event: 'response.completed',
            data: {
              type: 'response.completed',
              response: {
                id: 'response-1',
                usage: { input_tokens: 10, output_tokens: 5 },
              },
            },
          };
        },
      },
    });
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'codex-runtime@example.test',
        password: 'correct horse battery staple',
        device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
      },
    });
    const registrationBody = registration.json() as { verificationToken: string };
    await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: registrationBody.verificationToken },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'codex-runtime@example.test',
        password: 'correct horse battery staple',
        device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
      },
    });
    const accessToken = (login.json() as { accessToken: string }).accessToken;
    const reservation = await app.inject({
      method: 'POST',
      url: '/v1/billing/reservations',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        taskId: 'codex-task-1',
        modelId: 'approved-core',
        mode: 'BUILD',
        amountCredits: '10',
        idempotencyKey: 'codex-task-1-reservation',
      },
    });
    expect(reservation.statusCode).toBe(201);
    const reservationId = (reservation.json() as { reservation: { reservationId: string } })
      .reservation.reservationId;
    const tokenResponse = await app.inject({
      method: 'POST',
      url: '/v1/runtime/codex/token',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { taskId: 'codex-task-1', reservationId },
    });
    expect(tokenResponse.statusCode).toBe(201);
    const runtimeToken = (tokenResponse.json() as { token: string }).token;
    const authorizedTool = await app.inject({
      method: 'POST',
      url: '/v1/runtime/codex/authorize',
      headers: { authorization: `Bearer ${runtimeToken}` },
      payload: {
        permission: 'terminal.run',
        action: 'command.execute',
        resource: 'npm test',
      },
    });
    expect(authorizedTool.statusCode).toBe(200);
    expect(authorizedTool.json()).toEqual({ allowed: true });
    const response = await app.inject({
      method: 'POST',
      url: `/runtime/codex/v1/responses?task_id=codex-task-1&reservation_id=${reservationId}`,
      headers: { authorization: `Bearer ${runtimeToken}` },
      payload: { model: 'approved-core', input: [{ role: 'user', content: 'hello' }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('response.output_text.delta');
    const stored = await receipts.listForTask('codex-task-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.inputTokens).toBe(10);
    expect(stored[0]?.outputTokens).toBe(5);
    const receiptResponse = await app.inject({
      method: 'GET',
      url: '/v1/billing/tasks/codex-task-1/receipts',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-lyntar-reservation-id': reservationId,
      },
    });
    expect(receiptResponse.statusCode).toBe(200);
    expect(receiptResponse.json().receipts).toHaveLength(1);
  });

  it('rejects a runtime token when its task context is changed', async () => {
    const app = buildApi({
      auth: new AuthService({ store: new InMemoryAuthStore() }),
      runtimeTokenSecret: 'runtime-test-secret-with-at-least-32-bytes',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/runtime/codex/v1/responses?task_id=wrong&reservation_id=wrong',
      headers: { authorization: 'Bearer not-a-runtime-token' },
      payload: { model: 'approved-core', input: [] },
    });
    expect(response.statusCode).toBe(401);
  });
});
