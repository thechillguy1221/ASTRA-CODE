import { describe, expect, it, vi } from 'vitest';
import { VercelResponsesGatewayClient } from '@astra/model-gateway';

describe('Astra Responses gateway transport', () => {
  it('streams normalized SSE events without exposing the provider client to desktop code', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            'event: response.created\n' +
              'data: {"type":"response.created","response":{"id":"r1"}}\n\n' +
              'event: response.output_text.delta\n' +
              'data: {"type":"response.output_text.delta","delta":"hello"}\n\n' +
              'event: response.completed\n' +
              'data: {"type":"response.completed","response":{"id":"r1","usage":{"input_tokens":3,"output_tokens":2}}}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new VercelResponsesGatewayClient({
        baseUrl: 'https://gateway.example/v1',
        apiKey: 'server-only',
      });
      const events = [];
      for await (const event of client.stream(
        {
          requestId: 'req-1',
          model: 'gateway-model',
          body: { input: [{ role: 'user', content: 'hello' }] },
        },
        new AbortController().signal,
      ))
        events.push(event);
      expect(events.map((event) => event.event)).toEqual([
        'response.created',
        'response.output_text.delta',
        'response.completed',
      ]);
      expect(events[1]?.data).toMatchObject({ delta: 'hello' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://gateway.example/v1/responses',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer server-only' }),
          body: expect.stringContaining('"model":"gateway-model"'),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
