import { AUTO_MODEL_ID, type ModelCatalogEntry, type Wallet } from '@lyntar/contracts';
import type { ModelCatalogStore } from '@lyntar/db';
import { chooseAutoModel } from '@lyntar/model-gateway';

export interface RequestedModelInput {
  requestedModelId: string;
  planId: string;
  wallet?: Wallet;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
}

export interface ResolvedModel {
  model: ModelCatalogEntry;
  selectedByAuto: boolean;
  disclosure?: string;
}

function estimateInputTokens(input: RequestedModelInput): number {
  return Math.max(1, Math.min(input.inputTokenEstimate ?? 4_000, 100_000));
}

/**
 * Resolve a requested model without ever substituting an explicitly selected model.
 * AUTO is the only sentinel that permits server-side routing.
 */
export async function resolveRequestedModel(
  catalog: ModelCatalogStore,
  input: RequestedModelInput,
): Promise<ResolvedModel | undefined> {
  if (input.requestedModelId !== AUTO_MODEL_ID) {
    const model = await catalog.getEnabled(input.requestedModelId);
    return model ? { model, selectedByAuto: false } : undefined;
  }

  const models = await catalog.listEnabled();
  if (models.length === 0) return undefined;
  const selection = chooseAutoModel({
    catalog: models,
    planId: input.planId,
    mode: 'Balanced',
    taskType: 'coding task',
    inputTokenEstimate: estimateInputTokens(input),
    outputTokenEstimate: Math.max(1, Math.min(input.outputTokenEstimate ?? 2_048, 32_000)),
    requiredTools: true,
    walletCredits: input.wallet?.availableCredits ?? '0',
  });
  return {
    model: selection.model,
    selectedByAuto: true,
    disclosure: selection.disclosure,
  };
}
