import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface CodexRuntimeTokenClaims {
  scope: 'codex:runtime';
  userId: string;
  deviceSessionId: string;
  taskId: string;
  reservationId: string;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
}

export interface StoredRuntimeToken {
  accessToken: string;
  claims: CodexRuntimeTokenClaims;
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/**
 * Short-lived, task-bound credentials for the bundled Codex runtime.
 * The underlying Astra access token is retained only in server memory so
 * revocation still goes through AuthService when a runtime request arrives.
 */
export class CodexRuntimeTokenService {
  private readonly tokens = new Map<string, StoredRuntimeToken>();
  private readonly now: () => number;

  constructor(
    private readonly secret: string,
    options: { now?: () => number; ttlMs?: number } = {},
  ) {
    if (secret.trim().length < 32)
      throw new Error('ASTRA_RUNTIME_TOKEN_SECRET must contain at least 32 characters');
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  }

  private readonly ttlMs: number;

  issue(input: {
    accessToken: string;
    userId: string;
    deviceSessionId: string;
    taskId: string;
    reservationId: string;
  }): { token: string; claims: CodexRuntimeTokenClaims } {
    const issuedAt = this.now();
    const claims: CodexRuntimeTokenClaims = {
      scope: 'codex:runtime',
      userId: input.userId,
      deviceSessionId: input.deviceSessionId,
      taskId: input.taskId,
      reservationId: input.reservationId,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
      tokenId: randomUUID(),
    };
    const payload = base64Url(JSON.stringify(claims));
    const token = `${payload}.${sign(this.secret, payload)}`;
    this.tokens.set(token, { accessToken: input.accessToken, claims });
    return { token, claims };
  }

  verify(token: string): StoredRuntimeToken {
    const stored = this.tokens.get(token);
    if (!stored) throw new Error('Codex runtime token is invalid or expired');
    const [payload, signature] = token.split('.', 2);
    if (!payload || !signature) throw new Error('Codex runtime token is malformed');
    const expected = sign(this.secret, payload);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
      throw new Error('Codex runtime token signature is invalid');
    if (stored.claims.expiresAt <= this.now()) {
      this.tokens.delete(token);
      throw new Error('Codex runtime token is expired');
    }
    return stored;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  purgeExpired(): void {
    const now = this.now();
    for (const [token, stored] of this.tokens) {
      if (stored.claims.expiresAt <= now) this.tokens.delete(token);
    }
  }
}
