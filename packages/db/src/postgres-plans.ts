import type { Pool } from 'pg';
import { PlanSchema } from '@lyntar/contracts';
import { PlanCatalog } from '@lyntar/plans';

export async function loadPlanCatalog(pool: Pool, fallback: PlanCatalog): Promise<PlanCatalog> {
  const result = await pool.query(
    'SELECT id, display_name, monthly_price_inr, monthly_credits, entitlements, enabled FROM plans ORDER BY id ASC',
  );
  if (result.rows.length === 0) return fallback;
  const plans = result.rows.map((row) => {
    const entitlements = row.entitlements as Record<string, unknown>;
    return PlanSchema.parse({
      id: String(row.id),
      displayName: String(row.display_name),
      monthlyPriceInr: String(row.monthly_price_inr),
      monthlyCredits: String(row.monthly_credits),
      ...entitlements,
      enabled: Boolean(row.enabled),
    });
  });
  return new PlanCatalog(plans);
}
