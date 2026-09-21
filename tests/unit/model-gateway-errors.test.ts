import { afterEach, describe, expect, it, vi } from 'vitest';
import { VercelGatewayClient } from '@astra/model-gateway';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('model gateway error handling', () => {
  it('does not copy provider response bodies or credentials into errors', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('Authorization: Bearer secret-value', { status: 502 }),
    );
    const gateway = new VercelGatewayClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'secret-value',
    });

    const iterator = gateway
      .complete(
        {
          requestId: 'request-error',
          taskId: 'task-error',
          modelId: 'model-error',
          gatewayModelId: 'provider/model-error',
          messages: [{ role: 'user', content: 'test' }],
        },
        new AbortController().signal,
      )
      [Symbol.asyncIterator]();

    let error: unknown;
    try {
      await iterator.next();
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain('502');
    expect(String(error)).not.toContain('secret-value');
  });
});
