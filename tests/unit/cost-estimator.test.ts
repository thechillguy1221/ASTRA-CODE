import { describe, it, expect } from 'vitest';
import { estimateTaskCost, getWarningLevel } from '@astra/agent-core';
import type { ModelCatalogEntry, SpendingThresholds } from '@astra/contracts';
import { SpendingThresholdsSchema } from '@astra/contracts';

const model: ModelCatalogEntry = {
  modelId: 'fable-5.1',
  displayName: 'Fable 5.1',
  gatewayModelId: 'gateway-fable-5.1',
  providerSlug: 'fable-provider',
  enabled: true,
  visible: true,
  capabilities: {
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: false,
    supportsStructuredOutput: true,
    supportsImageInput: false,
  },
  costMetadata: { inputUsdPer1k: 0.003, outputUsdPer1k: 0.015 },
};

const defaultThresholds: SpendingThresholds = SpendingThresholdsSchema.parse({});

describe('Cost estimator (spec §11-13)', () => {
  it('returns a range (min and max) not a single number', () => {
    const estimate = estimateTaskCost({
      model,
      estimatedMinInputTokens: 10_000,
      estimatedMaxInputTokens: 20_000,
      estimatedMinOutputTokens: 1_000,
      estimatedMaxOutputTokens: 5_000,
      currentBalanceCredits: '100',
    });
    expect(estimate.estimatedMinCredits).toBeDefined();
    expect(estimate.estimatedMaxCredits).toBeDefined();
    // Max should be >= min
    const min = parseFloat(estimate.estimatedMinCredits);
    const max = parseFloat(estimate.estimatedMaxCredits);
    expect(max).toBeGreaterThanOrEqual(min);
  });

  it('includes selected model info in estimate', () => {
    const estimate = estimateTaskCost({
      model,
      estimatedMinInputTokens: 5_000,
      estimatedMaxInputTokens: 10_000,
      estimatedMinOutputTokens: 500,
      estimatedMaxOutputTokens: 2_000,
      currentBalanceCredits: '50',
    });
    expect(estimate.selectedModelId).toBe('fable-5.1');
    expect(estimate.selectedModelDisplayName).toBe('Fable 5.1');
  });

  it('small task produces warning level "none" — no interruption (spec §79 item 25)', () => {
    // A tiny task that uses < 1 credit
    const estimate = estimateTaskCost({
      model,
      estimatedMinInputTokens: 100,
      estimatedMaxInputTokens: 500,
      estimatedMinOutputTokens: 50,
      estimatedMaxOutputTokens: 200,
      currentBalanceCredits: '100',
    });
    const level = getWarningLevel(estimate, defaultThresholds);
    expect(level).toBe('none');
  });

  it('large task produces auth-required level (spec §79 item 24)', () => {
    // A task estimated to cost more than maxSingleTaskCredits (default 100)
    const estimate = estimateTaskCost({
      model,
      estimatedMinInputTokens: 1_000_000,
      estimatedMaxInputTokens: 2_000_000,
      estimatedMinOutputTokens: 100_000,
      estimatedMaxOutputTokens: 200_000,
      currentBalanceCredits: '500',
    });
    const level = getWarningLevel(estimate, defaultThresholds);
    expect(level).toBe('auth-required');
  });

  it('task that could exhaust balance produces auth-required', () => {
    const estimate = estimateTaskCost({
      model,
      estimatedMinInputTokens: 50_000,
      estimatedMaxInputTokens: 100_000,
      estimatedMinOutputTokens: 10_000,
      estimatedMaxOutputTokens: 30_000,
      currentBalanceCredits: '5', // Very low balance
    });
    const level = getWarningLevel(estimate, defaultThresholds);
    expect(level).toBe('auth-required');
  });

  it('couldExhaustBalance is true when max cost >= balance', () => {
    const estimate = estimateTaskCost({
      model,
      estimatedMinInputTokens: 100_000,
      estimatedMaxInputTokens: 500_000,
      estimatedMinOutputTokens: 10_000,
      estimatedMaxOutputTokens: 50_000,
      currentBalanceCredits: '10',
    });
    expect(estimate.couldExhaustBalance).toBe(true);
  });

  it('current balance is included in estimate for display', () => {
    const estimate = estimateTaskCost({
      model,
      estimatedMinInputTokens: 5_000,
      estimatedMaxInputTokens: 10_000,
      estimatedMinOutputTokens: 500,
      estimatedMaxOutputTokens: 2_000,
      currentBalanceCredits: '187',
    });
    expect(estimate.currentBalanceCredits).toBe('187');
  });
});
