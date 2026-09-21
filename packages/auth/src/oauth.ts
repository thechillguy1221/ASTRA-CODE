import { createHash, randomBytes } from 'node:crypto';
import type { AuthProvider } from '@astra/contracts';
import type { AuthService } from './service.js';
import type { AuthSessionResult, DeviceInput } from './ports.js';

export interface OAuthTransaction {
  state: string;
  provider: AuthProvider;
  codeChallenge: string;
  redirectUri: string;
  desktopCallbackUri?: string;
  device: DeviceInput;
  expiresAt: string;
  consumedAt: string | null;
}

export interface GoogleProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

export interface GoogleOAuthProvider {
  buildAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleProfile>;
}

export interface DesktopOAuthCode {
  codeHash: string;
  codeChallenge: string;
  profile: GoogleProfile;
  device: DeviceInput;
  expiresAt: string;
  usedAt: string | null;
}

export interface OAuthTransactionStore {
  save(transaction: OAuthTransaction): Promise<void> | void;
  get(state: string): Promise<OAuthTransaction | undefined> | OAuthTransaction | undefined;
  claimTransaction(
    state: string,
    now: string,
  ): Promise<OAuthTransaction | undefined> | OAuthTransaction | undefined;
  saveDesktopCode(code: DesktopOAuthCode): Promise<void> | void;
  getDesktopCode(
    codeHash: string,
  ): Promise<DesktopOAuthCode | undefined> | DesktopOAuthCode | undefined;
  claimDesktopCode(
    codeHash: string,
    now: string,
  ): Promise<DesktopOAuthCode | undefined> | DesktopOAuthCode | undefined;
}

export class InMemoryOAuthTransactionStore implements OAuthTransactionStore {
  readonly transactions = new Map<string, OAuthTransaction>();
  readonly desktopCodes = new Map<
    string,
    {
      codeHash: string;
      codeChallenge: string;
      profile: GoogleProfile;
      device: DeviceInput;
      expiresAt: string;
      usedAt: string | null;
    }
  >();

  save(transaction: OAuthTransaction): void {
    this.transactions.set(transaction.state, transaction);
  }

  get(state: string): OAuthTransaction | undefined {
    return this.transactions.get(state);
  }

  claimTransaction(state: string, now: string): OAuthTransaction | undefined {
    const transaction = this.transactions.get(state);
    if (
      !transaction ||
      transaction.consumedAt ||
      new Date(transaction.expiresAt).getTime() <= new Date(now).getTime()
    )
      return undefined;
    this.transactions.set(state, { ...transaction, consumedAt: now });
    return transaction;
  }

  saveDesktopCode(code: DesktopOAuthCode): void {
    this.desktopCodes.set(code.codeHash, code);
  }

  getDesktopCode(codeHash: string): DesktopOAuthCode | undefined {
    return this.desktopCodes.get(codeHash);
  }

  claimDesktopCode(codeHash: string, now: string): DesktopOAuthCode | undefined {
    const code = this.desktopCodes.get(codeHash);
    if (!code || code.usedAt || new Date(code.expiresAt).getTime() <= new Date(now).getTime())
      return undefined;
    this.desktopCodes.set(codeHash, { ...code, usedAt: now });
    return code;
  }
}

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
}

export class GoogleOidcProvider implements GoogleOAuthProvider {
  private readonly authorizationEndpoint: string;
  private readonly tokenEndpoint: string;
  private readonly userInfoEndpoint: string;

  constructor(private readonly options: GoogleOAuthOptions) {
    this.authorizationEndpoint =
      options.authorizationEndpoint ?? 'https://accounts.google.com/o/oauth2/v2/auth';
    this.tokenEndpoint = options.tokenEndpoint ?? 'https://oauth2.googleapis.com/token';
    this.userInfoEndpoint =
      options.userInfoEndpoint ?? 'https://openidconnect.googleapis.com/v1/userinfo';
  }

  buildAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const url = new URL(this.authorizationEndpoint);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleProfile> {
    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) throw new Error('Google token exchange failed');
    const token = (await response.json()) as { access_token?: unknown };
    if (typeof token.access_token !== 'string')
      throw new Error('Google token response was invalid');
    const profileResponse = await fetch(this.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!profileResponse.ok) throw new Error('Google identity lookup failed');
    const profile = (await profileResponse.json()) as {
      sub?: unknown;
      email?: unknown;
      email_verified?: unknown;
      name?: unknown;
    };
    if (
      typeof profile.sub !== 'string' ||
      typeof profile.email !== 'string' ||
      profile.email_verified !== true
    )
      throw new Error('Google identity was not verified');
    return {
      subject: profile.sub,
      email: profile.email,
      emailVerified: true,
      ...(typeof profile.name === 'string' ? { displayName: profile.name } : {}),
    };
  }
}

export function createPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class GoogleDesktopOAuthService {
  constructor(
    private readonly options: {
      provider: GoogleOAuthProvider;
      auth: AuthService;
      store: OAuthTransactionStore;
      redirectUri: string;
      desktopCallbackUri?: string;
      transactionTtlMs?: number;
      codeTtlMs?: number;
      now?: () => Date;
    },
  ) {}

  async begin(input: { codeChallenge: string; device: DeviceInput }): Promise<{
    state: string;
    authorizationUrl: string;
  }> {
    const now = this.now();
    const state = randomBytes(32).toString('base64url');
    const transaction: OAuthTransaction = {
      state,
      provider: 'google',
      codeChallenge: input.codeChallenge,
      redirectUri: this.options.redirectUri,
      ...(this.options.desktopCallbackUri
        ? { desktopCallbackUri: this.options.desktopCallbackUri }
        : {}),
      device: input.device,
      expiresAt: new Date(
        now.getTime() + (this.options.transactionTtlMs ?? 10 * 60 * 1000),
      ).toISOString(),
      consumedAt: null,
    };
    await this.options.store.save(transaction);
    return {
      state,
      authorizationUrl: this.options.provider.buildAuthorizationUrl({
        state,
        codeChallenge: input.codeChallenge,
        redirectUri: this.options.redirectUri,
      }),
    };
  }

  async completeCallback(input: {
    state: string;
    code: string;
  }): Promise<{ desktopCode: string; redirectUri?: string }> {
    const transaction = await this.options.store.claimTransaction(
      input.state,
      this.now().toISOString(),
    );
    if (!transaction) throw new Error('OAuth transaction is invalid or expired');
    const profile = await this.options.provider.exchangeCode({
      code: input.code,
      redirectUri: transaction.redirectUri,
    });
    const desktopCode = randomBytes(32).toString('base64url');
    await this.options.store.saveDesktopCode({
      codeHash: hash(desktopCode),
      codeChallenge: transaction.codeChallenge,
      profile,
      device: transaction.device,
      expiresAt: new Date(
        this.now().getTime() + (this.options.codeTtlMs ?? 60 * 1000),
      ).toISOString(),
      usedAt: null,
    });
    if (!transaction.desktopCallbackUri) return { desktopCode };
    const callback = new URL(transaction.desktopCallbackUri);
    callback.searchParams.set('code', desktopCode);
    callback.searchParams.set('state', transaction.state);
    return { desktopCode, redirectUri: callback.toString() };
  }

  async exchangeDesktopCode(input: { code: string; verifier: string }): Promise<AuthSessionResult> {
    const codeHash = hash(input.code);
    const record = await this.options.store.getDesktopCode(codeHash);
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= this.now().getTime())
      throw new Error('Desktop OAuth code is invalid or expired');
    if (createPkceChallenge(input.verifier) !== record.codeChallenge)
      throw new Error('Desktop OAuth proof is invalid');
    const claimed = await this.options.store.claimDesktopCode(codeHash, this.now().toISOString());
    if (!claimed) throw new Error('Desktop OAuth code is invalid or expired');
    return this.options.auth.loginExternal({
      provider: 'google',
      ...claimed.profile,
      device: claimed.device,
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
