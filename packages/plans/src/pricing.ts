export type PricingRegion = 'INDIA' | 'GLOBAL';
export type PricingCurrency = 'INR' | 'USD';

export interface RegionalPrice {
  currency: PricingCurrency;
  amount: string;
  taxIncluded: boolean;
}

export interface CreditPack {
  id: string;
  credits: string;
  validityDays: number;
  prices: Record<PricingRegion, RegionalPrice>;
}

export interface RegionalPlanPrice {
  planId: string;
  currency: PricingCurrency;
  amount: string;
  taxIncluded: boolean;
}

const INDIA_COUNTRY_CODES = new Set(['IN']);

/**
 * V1 pricing is intentionally limited to two regions. Country is a pricing
 * signal, not an authorization credential; checkout must verify it again.
 */
export function pricingRegionForCountryCode(countryCode: string | null | undefined): PricingRegion {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized && INDIA_COUNTRY_CODES.has(normalized) ? 'INDIA' : 'GLOBAL';
}

export function normalizeCountryCode(countryCode: string | null | undefined): string | null {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export const PLAN_REGIONAL_PRICES: Readonly<Record<string, Record<PricingRegion, RegionalPrice>>> =
  Object.freeze({
    FREE: {
      INDIA: { currency: 'INR', amount: '0', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '0', taxIncluded: true },
    },
    BASIC: {
      INDIA: { currency: 'INR', amount: '549', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '6', taxIncluded: true },
    },
    PRO: {
      INDIA: { currency: 'INR', amount: '999', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '11', taxIncluded: true },
    },
    MAX: {
      INDIA: { currency: 'INR', amount: '1899', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '21', taxIncluded: true },
    },
    TEAM: {
      INDIA: { currency: 'INR', amount: '9499', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '105', taxIncluded: true },
    },
    BUSINESS: {
      INDIA: { currency: 'INR', amount: '18999', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '209', taxIncluded: true },
    },
  });

export const CREDIT_PACKS: readonly CreditPack[] = Object.freeze([
  {
    id: 'TOPUP_50',
    credits: '50',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '100', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '0.8', taxIncluded: true },
    },
  },
  {
    id: 'TOPUP_100',
    credits: '100',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '200', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '1.6', taxIncluded: true },
    },
  },
  {
    id: 'TOPUP_250',
    credits: '250',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '500', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '4', taxIncluded: true },
    },
  },
  {
    id: 'TOPUP_500',
    credits: '500',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '950', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '8', taxIncluded: true },
    },
  },
  {
    id: 'TOPUP_1000',
    credits: '1000',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '1800', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '16', taxIncluded: true },
    },
  },
  {
    id: 'TOPUP_2500',
    credits: '2500',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '4250', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '38', taxIncluded: true },
    },
  },
  {
    id: 'TOPUP_5000',
    credits: '5000',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '8000', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '72', taxIncluded: true },
    },
  },
  {
    id: 'TOPUP_10000',
    credits: '10000',
    validityDays: 365,
    prices: {
      INDIA: { currency: 'INR', amount: '15000', taxIncluded: true },
      GLOBAL: { currency: 'USD', amount: '135', taxIncluded: true },
    },
  },
]);

export const STANDARD_CREDIT_RATES: Readonly<Record<PricingRegion, RegionalPrice>> = Object.freeze({
  INDIA: { currency: 'INR', amount: '2', taxIncluded: true },
  GLOBAL: { currency: 'USD', amount: '0.016', taxIncluded: true },
});

export function getPlanRegionalPrice(planId: string, region: PricingRegion): RegionalPlanPrice {
  const pricing = PLAN_REGIONAL_PRICES[planId]?.[region];
  if (!pricing) throw new Error(`No regional price configured for plan ${planId}`);
  return { planId, ...pricing };
}

export function getCreditPack(packId: string): CreditPack {
  const pack = CREDIT_PACKS.find((candidate) => candidate.id === packId);
  if (!pack) throw new Error(`Unknown credit pack: ${packId}`);
  return pack;
}

export function listRegionalPlans(region: PricingRegion): RegionalPlanPrice[] {
  return Object.keys(PLAN_REGIONAL_PRICES).map((planId) => getPlanRegionalPrice(planId, region));
}

export function listCreditPacks(
  region: PricingRegion,
): Array<CreditPack & { price: RegionalPrice }> {
  return CREDIT_PACKS.map((pack) => ({ ...pack, price: pack.prices[region] }));
}
