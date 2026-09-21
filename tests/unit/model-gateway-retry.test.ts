import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelGatewayError, VercelGatewayClient } from '@astra/model-gateway';

afterEach(() => vi.unstubAllGlobals());

const request = {
  requestId: 'retry-request',
  taskId: 'retry-task',
  modelId: 'catalog-model',
  gatewayModelId: 'provider/model',
  messages: [{ role: 'user' as const, content: 'test' }],
};

describe('model gateway retry policy', () => {
  it('retries rate limits before streaming while keeping the selected model', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '0' } });
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'provider/model',
        stream: true,
      });
      return new Response(
        'data: {"id":"gateway-1","choices":[{"delta":{"content":"{\\"kind\\":\\"finish\\",\\"summary\\":\\"done\\"}"}}]}\n\n' +
          'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const gateway = new VercelGatewayClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'redacted-test-key',
      baseDelayMs: 0,
      random: () => 0,
    });
    const events = [];
    for await (const event of gateway.complete(request, new AbortController().signal))
      events.push(event);
    expect(calls).toBe(2);
    expect(events.some((event) => event.type === 'decision')).toBe(true);
  });

  it('does not retry non-transient failures and never includes response content', async () => {
    vi.stubGlobal('fetch', async () => new Response('secret response body', { status: 400 }));
    const gateway = new VercelGatewayClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'secret-key',
    });
    await expect(
      (async () => {
        for await (const _event of gateway.complete(request, new AbortController().signal)) return;
      })(),
    ).rejects.toMatchObject({
      name: 'ModelGatewayError',
      status: 400,
    } satisfies Partial<ModelGatewayError>);
    await expect(
      (async () => {
        for await (const _event of gateway.complete(request, new AbortController().signal)) return;
      })(),
    ).rejects.not.toThrow('secret response body');
  });
});
