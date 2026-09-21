import type {
  ModelCatalogEntry,
  CostEstimate,
  SpendingThresholds,
  CostWarningLevel,
} from '@astra/contracts';
import { calculateExpectedCostUsd } from '@astra/model-gateway';
import { compareCredits, creditsFromUsd, formatCredits, parseCredits } from '@astra/billing';

/**
 * Estimates the credit cost for a planned AI task before execution.
 * Returns a range (min/max) because token counts are uncertain before inference.
 *
 * Local operations (file reads, git, grep, linting, builds) cost ZERO AI credits.
 * Credits are only consumed by remote AI inference.
 */
export function estimateTaskCost(input: {
  model: ModelCatalogEntry;
  estimatedMinInputTokens: number;
  estimatedMaxInputTokens: number;
  estimatedMinOutputTokens: number;
  estimatedMaxOutputTokens: number;
  currentBalanceCredits: string;
}): CostEstimate {
  const minCostUsd = calculateExpectedCostUsd(
    { inputTokens: input.estimatedMinInputTokens, outputTokens: input.estimatedMinOutputTokens },
    input.model.costMetadata,
  );
  const maxCostUsd = calculateExpectedCostUsd(
    { inputTokens: input.estimatedMaxInputTokens, outputTokens: input.estimatedMaxOutputTokens },
    input.model.costMetadata,
  );

  function usdToCreditsStr(usd: number | null): string {
    if (usd === null) return '0';
    // The estimator uses the same fixed-point conversion as settlement. The
    // floating-point model-cost result is normalized to the USD contract before
    // it enters credit arithmetic; it is never the ledger source of truth.
    return creditsFromUsd(usd.toFixed(10));
  }

  const minCredits = usdToCreditsStr(minCostUsd);
  const maxCredits = usdToCreditsStr(maxCostUsd);

  const balance = parseCredits(input.currentBalanceCredits);
  const minCreditsBig = parseCredits(minCredits);
  const maxCreditsBig = parseCredits(maxCredits);

  const balanceAfterMin = balance >= minCreditsBig ? formatCredits(balance - minCreditsBig) : '0';
  const balanceAfterMax = balance >= maxCreditsBig ? formatCredits(balance - maxCreditsBig) : '0';

  const couldExhaustBalance = compareCredits(maxCredits, input.currentBalanceCredits) >= 0;

  return {
    selectedModelId: input.model.modelId,
    selectedModelDisplayName: input.model.displayName,
    estimatedMinInputTokens: input.estimatedMinInputTokens,
    estimatedMaxInputTokens: input.estimatedMaxInputTokens,
    estimatedMinOutputTokens: input.estimatedMinOutputTokens,
    estimatedMaxOutputTokens: input.estimatedMaxOutputTokens,
    estimatedMinCredits: minCredits,
    estimatedMaxCredits: maxCredits,
    currentBalanceCredits: input.currentBalanceCredits,
    expectedMinBalanceAfter: balanceAfterMin,
    expectedMaxBalanceAfter: balanceAfterMax,
    couldExhaustBalance,
  };
}

/**
 * Determines what level of user warning/authorization is needed before a task.
 *
 * Returns 'none' for small tasks — do NOT interrupt the user with modals.
 * Returns 'auth-required' only when the task could exhaust the account or
 * exceed explicitly configured thresholds.
 */
export function getWarningLevel(
  estimate: CostEstimate,
  thresholds: SpendingThresholds,
): CostWarningLevel {
  const { estimatedMaxCredits, currentBalanceCredits, couldExhaustBalance } = estimate;

  if (couldExhaustBalance) return 'auth-required';

  const maxCredits = parseCredits(estimatedMaxCredits);
  const balance = parseCredits(currentBalanceCredits);
  const maxTaskCredits = parseCredits(thresholds.maxSingleTaskCredits);
  const authThreshold = parseCredits(thresholds.requireAuthAboveCredits);
  const warnThreshold = parseCredits(thresholds.warnAboveCredits);

  if (maxCredits >= maxTaskCredits) return 'auth-required';
  if (maxCredits >= authThreshold) return 'auth-required';

  // Check percentage thresholds
  if (balance > 0n) {
    const percentOfBalance = Number(maxCredits * 100n) / Number(balance);
    if (percentOfBalance >= thresholds.requireAuthAbovePercentOfBalance) return 'auth-required';
    if (percentOfBalance >= thresholds.warnAbovePercentOfBalance) return 'warn';
  }

  if (maxCredits >= warnThreshold) return 'info';

  return 'none';
}
