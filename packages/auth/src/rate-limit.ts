import { createHash } from 'node:crypto';

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    input: { limit: number; windowMs: number; now?: number },
  ): Promise<RateLimitDecision>;
  reset?(key: string): Promise<void>;
}

/**
 * Deterministic adapter for tests and single-process development.
 * Production API instances must inject the PostgreSQL/Redis-backed adapter.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  async consume(
    key: string,
    input: { limit: number; windowMs: number; now?: number },
  ): Promise<RateLimitDecision> {
    const now = input.now ?? Date.now();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= input.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true, remaining: Math.max(0, input.limit - 1), retryAfterMs: 0 };
    }
    if (current.count >= input.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, input.windowMs - (now - current.startedAt)),
      };
    }
    current.count += 1;
    return { allowed: true, remaining: Math.max(0, input.limit - current.count), retryAfterMs: 0 };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }
}

export function hashRateLimitIdentity(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}
