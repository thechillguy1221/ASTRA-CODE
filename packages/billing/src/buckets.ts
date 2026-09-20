import {
  addCredits,
  compareCredits,
  formatCredits,
  parseCredits,
  subtractCredits,
} from './math.js';

export const TOP_UP_250 = {
  id: 'TOPUP_250',
  displayName: '250 credits',
  credits: '250',
  priceInr: '499',
  validityDays: 365,
} as const;

/** One additional monthly allocation is the maximum subscription rollover. */
export function calculateSubscriptionRollover(
  remainingCredits: string,
  monthlyAllocation: string,
  rolloverCycles = 1,
): string {
  const maximum = parseCredits(monthlyAllocation) * BigInt(Math.max(0, rolloverCycles));
  const remaining = parseCredits(remainingCredits);
  return formatCredits(remaining < maximum ? remaining : maximum);
}

export function topUpExpiresAt(createdAt: string, validityDays = TOP_UP_250.validityDays): string {
  return new Date(new Date(createdAt).getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString();
}

export function consumeEarliestExpiringBuckets(
  buckets: Array<{
    id: string;
    remainingCredits: string;
    expiresAt: string | null;
    createdAt: string;
  }>,
  amountCredits: string,
): Array<{ bucketId: string; amountCredits: string }> {
  const amount = parseCredits(amountCredits);
  const ordered = [...buckets].sort((left, right) => {
    const leftExpiry = left.expiresAt
      ? new Date(left.expiresAt).getTime()
      : Number.POSITIVE_INFINITY;
    const rightExpiry = right.expiresAt
      ? new Date(right.expiresAt).getTime()
      : Number.POSITIVE_INFINITY;
    return leftExpiry - rightExpiry || left.createdAt.localeCompare(right.createdAt);
  });
  let remaining = amount;
  const result: Array<{ bucketId: string; amountCredits: string }> = [];
  for (const bucket of ordered) {
    if (remaining <= 0n) break;
    const available = parseCredits(bucket.remainingCredits);
    const take = available < remaining ? available : remaining;
    if (take <= 0n) continue;
    result.push({ bucketId: bucket.id, amountCredits: formatCredits(take) });
    remaining -= take;
  }
  if (remaining > 0n) throw new Error('Insufficient unexpired credit buckets');
  return result;
}

export function addBucketCredits(current: string, amount: string): string {
  return addCredits(current, amount);
}

export function subtractBucketCredits(current: string, amount: string): string {
  if (compareCredits(current, amount) < 0) throw new Error('Bucket balance cannot be negative');
  return subtractCredits(current, amount);
}
