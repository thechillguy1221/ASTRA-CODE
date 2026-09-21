import type { Pool } from 'pg';
import type {
  DesktopOAuthCode,
  DeviceInput,
  OAuthTransaction,
  OAuthTransactionStore,
} from '@astra/auth';

export class PostgresOAuthTransactionStore implements OAuthTransactionStore {
  constructor(private readonly pool: Pool) {}

  async save(transaction: OAuthTransaction): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_transactions
        (state, provider, code_challenge, redirect_uri, desktop_callback_uri, device, expires_at, consumed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        transaction.state,
        transaction.provider,
        transaction.codeChallenge,
        transaction.redirectUri,
        transaction.desktopCallbackUri ?? null,
        transaction.device,
        transaction.expiresAt,
        transaction.consumedAt,
      ],
    );
  }

  async get(state: string): Promise<OAuthTransaction | undefined> {
    const result = await this.pool.query('SELECT * FROM oauth_transactions WHERE state = $1', [
      state,
    ]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      state: String(row.state),
      provider: String(row.provider) as OAuthTransaction['provider'],
      codeChallenge: String(row.code_challenge),
      redirectUri: String(row.redirect_uri),
      ...(row.desktop_callback_uri ? { desktopCallbackUri: String(row.desktop_callback_uri) } : {}),
      device: row.device as DeviceInput,
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      consumedAt: row.consumed_at ? new Date(String(row.consumed_at)).toISOString() : null,
    };
  }

  async update(transaction: OAuthTransaction): Promise<void> {
    await this.pool.query(`UPDATE oauth_transactions SET consumed_at = $2 WHERE state = $1`, [
      transaction.state,
      transaction.consumedAt,
    ]);
  }

  async claimTransaction(state: string, now: string): Promise<OAuthTransaction | undefined> {
    const result = await this.pool.query(
      `UPDATE oauth_transactions
          SET consumed_at = $2
        WHERE state = $1 AND consumed_at IS NULL AND expires_at > $2
        RETURNING *`,
      [state, now],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      state: String(row.state),
      provider: String(row.provider) as OAuthTransaction['provider'],
      codeChallenge: String(row.code_challenge),
      redirectUri: String(row.redirect_uri),
      ...(row.desktop_callback_uri ? { desktopCallbackUri: String(row.desktop_callback_uri) } : {}),
      device: row.device as DeviceInput,
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      consumedAt: null,
    };
  }

  async saveDesktopCode(code: DesktopOAuthCode): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_desktop_codes
        (code_hash, code_challenge, profile, device, expires_at, used_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [code.codeHash, code.codeChallenge, code.profile, code.device, code.expiresAt, code.usedAt],
    );
  }

  async getDesktopCode(codeHash: string): Promise<DesktopOAuthCode | undefined> {
    const result = await this.pool.query('SELECT * FROM oauth_desktop_codes WHERE code_hash = $1', [
      codeHash,
    ]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      codeHash: String(row.code_hash),
      codeChallenge: String(row.code_challenge),
      profile: row.profile as DesktopOAuthCode['profile'],
      device: row.device as DeviceInput,
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      usedAt: row.used_at ? new Date(String(row.used_at)).toISOString() : null,
    };
  }

  async updateDesktopCode(code: DesktopOAuthCode): Promise<void> {
    await this.pool.query('UPDATE oauth_desktop_codes SET used_at = $2 WHERE code_hash = $1', [
      code.codeHash,
      code.usedAt,
    ]);
  }

  async claimDesktopCode(codeHash: string, now: string): Promise<DesktopOAuthCode | undefined> {
    const result = await this.pool.query(
      `UPDATE oauth_desktop_codes
          SET used_at = $2
        WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2
        RETURNING *`,
      [codeHash, now],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      codeHash: String(row.code_hash),
      codeChallenge: String(row.code_challenge),
      profile: row.profile as DesktopOAuthCode['profile'],
      device: row.device as DeviceInput,
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      usedAt: null,
    };
  }
}
