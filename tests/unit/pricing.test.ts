import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKS,
  PLAN_REGIONAL_PRICES,
  STANDARD_CREDIT_RATES,
  getCreditPack,
  getPlanRegionalPrice,
  listCreditPacks,
  pricingRegionForCountryCode,
} from '@lyntar/plans';

describe('Astra Code regional commercial catalog', () => {
  it('keeps the finalized India and Global subscription prices centralized', () => {
    expect(getPlanRegionalPrice('BASIC', 'INDIA')).toMatchObject({
      currency: 'INR',
      amount: '549',
      taxIncluded: true,
    });
    expect(getPlanRegionalPrice('BASIC', 'GLOBAL')).toMatchObject({
      currency: 'USD',
      amount: '6',
      taxIncluded: true,
    });
    expect(getPlanRegionalPrice('BUSINESS', 'INDIA').amount).toBe('18999');
    expect(getPlanRegionalPrice('BUSINESS', 'GLOBAL').amount).toBe('209');
    expect(Object.keys(PLAN_REGIONAL_PRICES)).toEqual([
      'FREE',
      'BASIC',
      'PRO',
      'MAX',
      'TEAM',
      'BUSINESS',
    ]);
  });

  it('uses country only as a two-region pricing signal', () => {
    expect(pricingRegionForCountryCode('in')).toBe('INDIA');
    expect(pricingRegionForCountryCode('IN')).toBe('INDIA');
    expect(pricingRegionForCountryCode('US')).toBe('GLOBAL');
    expect(pricingRegionForCountryCode('not-a-country')).toBe('GLOBAL');
    expect(pricingRegionForCountryCode(undefined)).toBe('GLOBAL');
  });

  it('supports repeated unlimited top-up purchases from a single catalog', () => {
    expect(CREDIT_PACKS.map((pack) => pack.id)).toEqual([
      'TOPUP_50',
      'TOPUP_100',
      'TOPUP_250',
      'TOPUP_500',
      'TOPUP_1000',
      'TOPUP_2500',
      'TOPUP_5000',
      'TOPUP_10000',
    ]);
    expect(getCreditPack('TOPUP_250').prices.GLOBAL.amount).toBe('4');
    expect(getCreditPack('TOPUP_500').prices.INDIA.amount).toBe('950');
    expect(listCreditPacks('GLOBAL').every((pack) => pack.validityDays === 365)).toBe(true);
    expect(STANDARD_CREDIT_RATES.INDIA.amount).toBe('2');
    expect(STANDARD_CREDIT_RATES.GLOBAL.amount).toBe('0.016');
  });
});
