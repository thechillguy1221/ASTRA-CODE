import { ModelCatalogEntrySchema, type ModelCatalogEntry } from '@lyntar/contracts';
import { calculateExpectedCostUsd } from './receipt.js';

export type AutoMode = 'Save Credits' | 'Balanced' | 'Best Result';

export interface AutoModelSelection {
  model: ModelCatalogEntry;
  estimatedCostUsd: string | null;
  requiresConfirmation: boolean;
  disclosure: string;
  reason: string;
}

export interface AutoModelInput {
  catalog: ModelCatalogEntry[];
  planId: string;
  mode: AutoMode;
  taskType: string;
  inputTokenEstimate: number;
  outputTokenEstimate: number;
  requiredTools: boolean;
  requiredVision?: boolean;
  requiredReasoning?: boolean;
  walletCredits: string;
}

function cost(model: ModelCatalogEntry, input: AutoModelInput): string | null {
  const expected = calculateExpectedCostUsd(
    { inputTokens: input.inputTokenEstimate, outputTokens: input.outputTokenEstimate },
    model.costMetadata,
  );
  return expected === null
    ? null
    : expected.toFixed(10).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export function chooseAutoModel(input: AutoModelInput): AutoModelSelection {
  const candidates = input.catalog
    .map((model) => ModelCatalogEntrySchema.parse(model))
    .filter((model) => model.enabled && model.visible !== false)
    .filter((model) => !model.planAccess || model.planAccess.includes(input.planId))
    .filter((model) => !input.requiredTools || model.capabilities.supportsTools)
    .filter((model) => !input.requiredVision || model.capabilities.supportsImageInput)
    .filter((model) => !input.requiredReasoning || model.capabilities.supportsReasoning);
  if (candidates.length === 0) throw new Error(`No eligible model for plan ${input.planId}`);
  const ranked = candidates.sort((left, right) => {
    const leftCost = cost(left, input);
    const rightCost = cost(right, input);
    const costCompare =
      leftCost === null || rightCost === null ? 0 : Number(leftCost) - Number(rightCost);
    if (input.mode === 'Save Credits' && costCompare !== 0) return costCompare;
    if (input.mode === 'Best Result') {
      if ((right.recommended ? 1 : 0) !== (left.recommended ? 1 : 0))
        return (right.recommended ? 1 : 0) - (left.recommended ? 1 : 0);
      return (
        (right.capabilities.supportsReasoning ? 1 : 0) -
        (left.capabilities.supportsReasoning ? 1 : 0)
      );
    }
    if ((right.recommended ? 1 : 0) !== (left.recommended ? 1 : 0))
      return (right.recommended ? 1 : 0) - (left.recommended ? 1 : 0);
    return costCompare;
  });
  const model = ranked[0] as ModelCatalogEntry;
  const estimatedCostUsd = cost(model, input);
  const requiresConfirmation = estimatedCostUsd !== null && Number(estimatedCostUsd) >= 0.05;
  return {
    model,
    estimatedCostUsd,
    requiresConfirmation,
    disclosure: `Auto selected ${model.displayName}`,
    reason: `${input.mode} routing for ${input.taskType}; model choice is server-controlled and plan-eligible`,
  };
}
