import { describe, expect, it } from 'vitest';
import {
  TOP_UP_250,
  calculateSubscriptionRollover,
  consumeEarliestExpiringBuckets,
  topUpExpiresAt,
} from '@lyntar/billing';

describe('commercial bucket policy', () => {
  it('caps subscription rollover at one monthly allocation', () => {
    expect(calculateSubscriptionRollover('700', '300', 1)).toBe('300');
    expect(calculateSubscriptionRollover('120', '300', 1)).toBe('120');
  });

  it('defines the server-controlled 250-credit top-up and expiration', () => {
    expect(TOP_UP_250).toMatchObject({
      id: 'TOPUP_250',
      credits: '250',
      priceInr: '499',
      validityDays: 365,
    });
    expect(topUpExpiresAt('2026-01-01T00:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('consumes earliest-expiring buckets before non-expiring balances', () => {
    expect(
      consumeEarliestExpiringBuckets(
        [
          {
            id: 'later',
            remainingCredits: '20',
            expiresAt: '2027-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'earlier',
            remainingCredits: '5',
            expiresAt: '2026-10-01T00:00:00.000Z',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        '8',
      ),
    ).toEqual([
      { bucketId: 'earlier', amountCredits: '5' },
      { bucketId: 'later', amountCredits: '3' },
    ]);
  });
});
