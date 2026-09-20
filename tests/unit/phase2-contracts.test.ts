import { describe, expect, it } from 'vitest';
import { AgentEventSchema, ModelCatalogEntrySchema } from '@lyntar/contracts';
import { parseUsageReceipt } from '@lyntar/model-gateway';

describe('phase 2 audit contracts', () => {
  it('reconciles provider cost against catalog pricing without replacing actual cost', () => {
    const receipt = parseUsageReceipt(
      {
        id: 'gateway-request-1',
        usage: { prompt_tokens: 100, completion_tokens: 50, cached_tokens: 25 },
        cost: { total: 0.02 },
      },
      {
        requestId: 'request-1',
        taskId: 'task-1',
        agentSessionId: 'session-1',
        modelId: 'catalog-model',
        gatewayModelId: 'provider/model',
        provider: 'provider',
        providerRoute: 'provider/model',
        costMetadata: {
          inputUsdPer1k: 0.01,
          outputUsdPer1k: 0.02,
          cacheReadUsdPer1k: 0,
        },
      },
    );

    expect(receipt).toMatchObject({
      gatewayRequestId: 'gateway-request-1',
      agentSessionId: 'session-1',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      actualCostUsd: 0.02,
      calculatedExpectedCostUsd: 0.002,
      costDifferenceUsd: 0.018,
      billingAnomaly: true,
    });
  });

  it('accepts server-controlled model catalog metadata', () => {
    const model = ModelCatalogEntrySchema.parse({
      modelId: 'balanced',
      displayName: 'Balanced',
      gatewayModelId: 'provider/model',
      providerSlug: 'provider',
      provider: 'provider',
      enabled: true,
      visible: true,
      contextWindow: 128_000,
      capabilities: {
        supportsTools: true,
        supportsStreaming: true,
        supportsReasoning: true,
        supportsStructuredOutput: true,
        supportsImageInput: false,
      },
      costMetadata: { inputUsdPer1k: 0.001, outputUsdPer1k: 0.002 },
      pricingVerifiedAt: '2026-09-20T00:00:00.000Z',
    });

    expect(model.contextWindow).toBe(128_000);
    expect(model.costMetadata.outputUsdPer1k).toBe(0.002);
  });

  it('accepts append-only streaming, patch, and usage audit events', () => {
    for (const event of [
      {
        eventId: 'event-1',
        taskId: 'task-1',
        occurredAt: new Date().toISOString(),
        type: 'model.streaming',
        payload: { summary: 'Model stream started' },
      },
      {
        eventId: 'event-2',
        taskId: 'task-1',
        occurredAt: new Date().toISOString(),
        type: 'patch.started',
        payload: { paths: ['src/index.ts'], fileCount: 1 },
      },
      {
        eventId: 'event-3',
        taskId: 'task-1',
        occurredAt: new Date().toISOString(),
        type: 'usage.received',
        payload: { requestId: 'request-1', actualCostUsd: 0.002 },
      },
    ]) {
      expect(AgentEventSchema.parse(event)).toMatchObject({ type: event.type });
    }
  });
});
