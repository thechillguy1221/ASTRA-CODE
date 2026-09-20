import { describe, expect, it } from 'vitest';
import { chooseAutoModel } from '@lyntar/model-gateway';

const capabilities = {
  supportsTools: true,
  supportsStreaming: true,
  supportsReasoning: true,
  supportsStructuredOutput: true,
  supportsImageInput: false,
};

describe('server-side Auto model routing', () => {
  const models = [
    {
      modelId: 'cheap',
      displayName: 'Cheap',
      gatewayModelId: 'provider/cheap',
      providerSlug: 'provider',
      enabled: true,
      visible: true,
      recommended: false,
      planAccess: ['FREE', 'STUDENT'],
      routingRole: 'fast',
      capabilities: { ...capabilities, supportsReasoning: false },
      costMetadata: { inputUsdPer1k: 0.001, outputUsdPer1k: 0.002 },
    },
    {
      modelId: 'balanced',
      displayName: 'Balanced',
      gatewayModelId: 'provider/balanced',
      providerSlug: 'provider',
      enabled: true,
      visible: true,
      recommended: true,
      planAccess: ['STUDENT'],
      routingRole: 'balanced',
      capabilities,
      costMetadata: { inputUsdPer1k: 0.01, outputUsdPer1k: 0.02 },
    },
    {
      modelId: 'frontier',
      displayName: 'Frontier',
      gatewayModelId: 'provider/frontier',
      providerSlug: 'provider',
      enabled: true,
      visible: true,
      recommended: false,
      planAccess: ['PRO'],
      routingRole: 'frontier',
      capabilities,
      costMetadata: { inputUsdPer1k: 0.05, outputUsdPer1k: 0.1 },
    },
  ];

  it('selects an eligible model and discloses the selection', () => {
    const result = chooseAutoModel({
      catalog: models,
      planId: 'STUDENT',
      mode: 'Balanced',
      taskType: 'coding',
      inputTokenEstimate: 1000,
      outputTokenEstimate: 1000,
      requiredTools: true,
      walletCredits: '500',
    });
    expect(result.model.modelId).toBe('balanced');
    expect(result.disclosure).toContain('Balanced');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('uses Save Credits routing and asks confirmation for expensive estimates', () => {
    const result = chooseAutoModel({
      catalog: models,
      planId: 'PRO',
      mode: 'Save Credits',
      taskType: 'coding',
      inputTokenEstimate: 1000,
      outputTokenEstimate: 1000,
      requiredTools: true,
      walletCredits: '100',
    });
    expect(result.model.modelId).toBe('frontier');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.estimatedCostUsd).toBe('0.15');
  });

  it('rejects a catalog with no plan-eligible model instead of accepting an arbitrary gateway id', () => {
    expect(() =>
      chooseAutoModel({
        catalog: models,
        planId: 'FREE',
        mode: 'Best Result',
        taskType: 'coding',
        inputTokenEstimate: 100,
        outputTokenEstimate: 100,
        requiredTools: true,
        requiredReasoning: true,
        walletCredits: '50',
      }),
    ).toThrow('eligible');
  });
});
