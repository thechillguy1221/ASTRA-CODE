import { describe, expect, it } from 'vitest';
import { InMemoryAdminAnalytics, NO_LIVE_DATA } from '@astra/billing';

describe('admin analytics data honesty', () => {
  it('returns NO_LIVE_DATA until a real snapshot is supplied', async () => {
    const analytics = new InMemoryAdminAnalytics();
    const overview = await analytics.overview();
    expect(overview.dataStatus).toBe(NO_LIVE_DATA);
    expect(overview.providerCostUsd).toBeNull();
    expect((await analytics.usage()).rows).toEqual([]);
  });

  it('keeps provider and customer economics as separate metrics', async () => {
    const analytics = new InMemoryAdminAnalytics();
    analytics.setLiveSnapshot({
      totalUsers: 10,
      verifiedUsers: 8,
      activeUsers: 7,
      dailyActiveUsers: 3,
      monthlyActiveUsers: 6,
      paidUsers: 2,
      freeUsers: 5,
      creditsIssued: '100.0000000',
      creditsConsumed: '27.8260000',
      providerCostUsd: '0.0278260000',
      customerCostUsd: '0.0278260000',
      absorbedCostUsd: '0',
      revenueUsd: '0.0278260000',
      grossMarginUsd: '0',
      grossMarginPercent: 0,
      paymentFailures: 0,
      billingAnomalies: 0,
    });
    const overview = await analytics.overview();
    expect(overview.dataStatus).toBe('LIVE');
    expect(overview.providerCostUsd).not.toBe(overview.creditsConsumed);
  });
});
