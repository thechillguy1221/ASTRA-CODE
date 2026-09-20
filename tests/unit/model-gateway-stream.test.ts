import { afterEach, describe, expect, it, vi } from 'vitest';
import { VercelGatewayClient } from '@lyntar/model-gateway';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('model gateway streaming', () => {
  it('parses a final SSE data line without a trailing newline and preserves usage', async () => {
    const decision = JSON.stringify({ kind: 'finish', summary: 'Verification passed' });
    const firstLine = `data: ${JSON.stringify({ id: 'provider-1', choices: [{ delta: { content: decision } }] })}\n`;
    const finalLine = `data: ${JSON.stringify({ usage: { prompt_tokens: 4, completion_tokens: 3 }, cost: { total: 0.001 } })}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${firstLine}${finalLine}`));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', async () => new Response(stream, { status: 200 }));

    const events = [];
    const gateway = new VercelGatewayClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'test-key',
    });
    for await (const event of gateway.complete(
      {
        requestId: 'request-1',
        taskId: 'task-1',
        modelId: 'model-1',
        gatewayModelId: 'provider/model-1',
        messages: [{ role: 'user', content: 'test' }],
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'provider', providerRequestId: 'provider-1' }),
        expect.objectContaining({
          type: 'decision',
          decision: { kind: 'finish', summary: 'Verification passed' },
        }),
        expect.objectContaining({
          type: 'usage',
          receipt: expect.objectContaining({ actualCostUsd: 0.001 }),
        }),
      ]),
    );
  });

  it('retains usage metadata when a later content chunk arrives after the usage chunk', async () => {
    const decision = JSON.stringify({ kind: 'finish', summary: 'Verification passed' });
    const split = Math.floor(decision.length / 2);
    const lines = [
      `data: ${JSON.stringify({ id: 'provider-2', choices: [{ delta: { content: decision.slice(0, split) } }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 4 }, cost: { total: 0.002 } })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: decision.slice(split) } }] })}`,
      'data: [DONE]',
    ].join('\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', async () => new Response(stream, { status: 200 }));

    const events = [];
    const gateway = new VercelGatewayClient({
      baseUrl: 'https://gateway.test',
      apiKey: 'test-key',
    });
    for await (const event of gateway.complete(
      {
        requestId: 'request-2',
        taskId: 'task-2',
        modelId: 'model-2',
        gatewayModelId: 'provider/model-2',
        messages: [{ role: 'user', content: 'test' }],
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'usage',
          receipt: expect.objectContaining({ actualCostUsd: 0.002 }),
        }),
      ]),
    );
  });
});
