import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryCatalog } from '@astra/api';
import type { UsageReceipt } from '@astra/contracts';

describe('API model stream boundary', () => {
  it('forwards model metadata, provider, decision, and usage as newline-delimited events', async () => {
    const usage: UsageReceipt = {
      requestId: 'request-stream-1',
      taskId: 'task-stream-1',
      modelId: 'model-stream-1',
      providerRoute: 'test/model-stream-1',
      inputTokens: 10,
      outputTokens: 5,
      cacheTokens: null,
      actualCostUsd: 0.15,
      receivedAt: new Date().toISOString(),
    };
    const app = buildApi({
      catalog: createMemoryCatalog([
        {
          modelId: 'model-stream-1',
          displayName: 'Stream test model',
          gatewayModelId: 'test/stream',
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
      ]),
      gateway: {
        async *complete() {
          yield { type: 'provider' as const, providerRequestId: 'gateway-stream-1' };
          yield {
            type: 'decision' as const,
            decision: { kind: 'finish' as const, summary: 'Finished through stream' },
          };
          yield { type: 'usage' as const, receipt: usage };
        },
      },
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const response = await fetch(`${address}/v1/model-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({
          requestId: 'request-stream-1',
          taskId: 'task-stream-1',
          modelId: 'model-stream-1',
          messages: [{ role: 'user', content: 'finish' }],
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/x-ndjson');
      const lines = (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string });
      expect(lines.map((line) => line.type)).toEqual(['model', 'provider', 'decision', 'usage']);
    } finally {
      await app.close();
    }
  });
});
