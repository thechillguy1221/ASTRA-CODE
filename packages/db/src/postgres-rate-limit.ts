import type { Pool } from 'pg';
import type { RateLimitDecision, RateLimitStore } from '@lyntar/auth';

/** PostgreSQL-backed fixed-window limiter shared by all API instances. */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly pool: Pool) {}

  async consume(
    key: string,
    input: { limit: number; windowMs: number; now?: number },
  ): Promise<RateLimitDecision> {
    const client = await this.pool.connect();
    const now = new Date(input.now ?? Date.now());
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT bucket_key, window_started_at, request_count
           FROM rate_limit_windows
          WHERE bucket_key = $1
          FOR UPDATE`,
        [key],
      );
      const row = result.rows[0] as
        { window_started_at: string | Date; request_count: number } | undefined;
      const startedAt = row ? new Date(row.window_started_at).getTime() : now.getTime();
      const expired = !row || now.getTime() - startedAt >= input.windowMs;
      if (expired) {
        await client.query(
          `INSERT INTO rate_limit_windows(bucket_key, window_started_at, request_count, updated_at)
           VALUES ($1, $2, 1, now())
           ON CONFLICT (bucket_key) DO UPDATE
             SET window_started_at = EXCLUDED.window_started_at,
                 request_count = 1,
                 updated_at = now()`,
          [key, now.toISOString()],
        );
        await client.query('COMMIT');
        return { allowed: true, remaining: Math.max(0, input.limit - 1), retryAfterMs: 0 };
      }
      const count = Number(row.request_count);
      if (count >= input.limit) {
        await client.query('COMMIT');
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(1, input.windowMs - (now.getTime() - startedAt)),
        };
      }
      await client.query(
        'UPDATE rate_limit_windows SET request_count = request_count + 1, updated_at = now() WHERE bucket_key = $1',
        [key],
      );
      await client.query('COMMIT');
      return { allowed: true, remaining: Math.max(0, input.limit - count - 1), retryAfterMs: 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reset(key: string): Promise<void> {
    await this.pool.query('DELETE FROM rate_limit_windows WHERE bucket_key = $1', [key]);
  }
}
