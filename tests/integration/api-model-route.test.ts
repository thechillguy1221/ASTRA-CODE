import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryCatalog, createMemoryReceiptStore } from '@astra/api';

describe('model request API', () => {
  it('normalizes a gateway decision and persists its actual usage receipt', async () => {
    const receipts = createMemoryReceiptStore();
    const app = buildApi({
      catalog: createMemoryCatalog([
        {
          modelId: 'balanced',
          displayName: 'Configured model',
          gatewayModelId: 'provider/model',
          providerSlug: 'provider',
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
      receipts,
      gateway: {
        async *complete() {
          yield { type: 'provider' as const, providerRequestId: 'gateway-req-1' };
          yield {
            type: 'decision' as const,
            decision: { kind: 'message' as const, summary: 'Inspecting repository' },
          };
          yield {
            type: 'usage' as const,
            receipt: {
              requestId: 'req-1',
              taskId: 'task-1',
              modelId: 'balanced',
              providerRoute: 'provider/model',
              inputTokens: 12,
              outputTokens: 7,
              cacheTokens: 4,
              actualCostUsd: 0.0031,
              receivedAt: new Date().toISOString(),
            },
          };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/model-requests',
      payload: {
        requestId: 'req-1',
        taskId: 'task-1',
        modelId: 'balanced',
        messages: [{ role: 'user', content: 'Inspect the repository' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().decision.summary).toBe('Inspecting repository');
    expect(response.json().providerRequestId).toBe('gateway-req-1');
    expect(await receipts.listForTask('task-1')).toHaveLength(1);
  });
});
