import { UsageReceiptSchema, type UsageReceipt } from '@lyntar/contracts';
import type { ModelCostMetadata } from '@lyntar/contracts';
import type { ReceiptContext } from './contracts.js';

function numberAt(value: unknown, ...paths: string[]): number | undefined {
  for (const path of paths) {
    const parts = path.split('.');
    let current: unknown = value;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (typeof current === 'number' && Number.isFinite(current) && current >= 0) return current;
  }
  return undefined;
}

function roundUsd(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}

export function calculateExpectedCostUsd(
  usage: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
    reasoningUnits?: number | undefined;
  },
  pricing: ModelCostMetadata | undefined,
): number | null {
  if (!pricing) return null;
  const components = [
    [usage.inputTokens, pricing.inputUsdPer1k],
    [usage.outputTokens, pricing.outputUsdPer1k],
    [usage.cacheReadTokens, pricing.cacheReadUsdPer1k],
    [usage.cacheWriteTokens, pricing.cacheWriteUsdPer1k],
    [usage.reasoningUnits, pricing.reasoningUsdPer1k],
  ] as const;
  let total = 0;
  let priced = false;
  for (const [units, usdPer1k] of components) {
    if (units === undefined || usdPer1k === undefined) continue;
    total += (units / 1_000) * usdPer1k;
    priced = true;
  }
  return priced ? roundUsd(total) : null;
}

export function parseUsageReceipt(raw: unknown, context: ReceiptContext): UsageReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const inputTokens = numberAt(
    raw,
    'usage.prompt_tokens',
    'usage.input_tokens',
    'usage.inputTokens',
    'response.usage.prompt_tokens',
    'response.usage.input_tokens',
    'response.usage.inputTokens',
  );
  const outputTokens = numberAt(
    raw,
    'usage.completion_tokens',
    'usage.output_tokens',
    'usage.outputTokens',
    'response.usage.completion_tokens',
    'response.usage.output_tokens',
    'response.usage.outputTokens',
  );
  const cacheTokens = numberAt(
    raw,
    'usage.cached_tokens',
    'usage.cache_read_input_tokens',
    'usage.prompt_tokens_details.cached_tokens',
    'usage.input_cached_tokens',
    'response.usage.cached_tokens',
    'response.usage.cache_read_input_tokens',
    'response.usage.prompt_tokens_details.cached_tokens',
  );
  const cacheWriteTokens = numberAt(
    raw,
    'usage.cache_write_input_tokens',
    'usage.cache_write_tokens',
    'response.usage.cache_write_input_tokens',
    'response.usage.cache_write_tokens',
  );
  const reasoningUnits = numberAt(
    raw,
    'usage.reasoning_tokens',
    'usage.reasoning_units',
    'usage.reasoningTokens',
    'response.usage.reasoning_tokens',
    'response.usage.reasoning_units',
    'response.usage.reasoningTokens',
  );
  const otherBillableUnits = numberAt(
    raw,
    'usage.other_billable_units',
    'response.usage.other_billable_units',
  );
  const actualCostUsd = numberAt(
    raw,
    'cost.total',
    'cost.totalCost',
    'providerMetadata.gateway.cost',
    'provider_metadata.gateway.cost',
    'usage.cost',
    'response.cost.total',
    'response.cost.totalCost',
    'response.usage.cost',
    'response.usage_metadata.cost',
  );
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheTokens === undefined &&
    actualCostUsd === undefined
  )
    return null;
  const calculatedExpectedCostUsd = calculateExpectedCostUsd(
    {
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheTokens,
      cacheWriteTokens,
      reasoningUnits,
    },
    context.costMetadata,
  );
  const costDifferenceUsd =
    actualCostUsd !== undefined && calculatedExpectedCostUsd !== null
      ? roundUsd(actualCostUsd - calculatedExpectedCostUsd)
      : null;
  const billingAnomaly =
    actualCostUsd !== undefined && calculatedExpectedCostUsd !== null && costDifferenceUsd !== null
      ? Math.abs(costDifferenceUsd) > 0.01 ||
        (calculatedExpectedCostUsd > 0 &&
          Math.abs(costDifferenceUsd) / calculatedExpectedCostUsd > 0.05)
      : false;
  const receivedAt = new Date().toISOString();
  const gatewayRequestId =
    typeof (raw as Record<string, unknown>).id === 'string'
      ? (raw as Record<string, unknown>).id
      : null;
  return UsageReceiptSchema.parse({
    ...context,
    gatewayRequestId,
    agentTaskId: context.taskId,
    gatewayModelId: context.gatewayModelId ?? null,
    provider: context.provider ?? null,
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    cacheTokens: cacheTokens ?? null,
    cacheReadTokens: cacheTokens ?? null,
    cacheWriteTokens: cacheWriteTokens ?? null,
    reasoningUnits: reasoningUnits ?? null,
    otherBillableUnits: otherBillableUnits ?? null,
    actualCostUsd: actualCostUsd ?? null,
    calculatedExpectedCostUsd,
    costDifferenceUsd,
    billingAnomaly,
    receivedAt,
    createdAt: receivedAt,
  });
}
