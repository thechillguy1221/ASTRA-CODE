import { afterEach, describe, expect, it, vi } from 'vitest';
import { VercelGatewayClient } from '@astra/model-gateway';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('model gateway cancellation', () => {
  it('passes the abort signal into the streaming provider request', async () => {
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) => {
      requestStarted();
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('provider request aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      });
    });

    const controller = new AbortController();
    const gateway = new VercelGatewayClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'test-key',
    });
    const iterator = gateway
      .complete(
        {
          requestId: 'request-1',
          taskId: 'task-1',
          modelId: 'model-1',
          gatewayModelId: 'provider/model-1',
          messages: [{ role: 'user', content: 'test' }],
        },
        controller.signal,
      )
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await started;
    controller.abort('user stopped task');

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
