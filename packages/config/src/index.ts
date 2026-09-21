import { z } from 'zod';
export * from './flags.js';

const EnvironmentSchema = z.object({
  LYNTAR_API_PORT: z.string().regex(/^\d+$/).default('4317'),
  LYNTAR_DATABASE_URL: z.string().url().optional(),
  LYNTAR_MODEL_GATEWAY_URL: z.string().url().optional(),
  LYNTAR_MODEL_GATEWAY_API_KEY: z.string().min(1).optional(),
  LYNTAR_RUNTIME_TOKEN_SECRET: z.string().min(32).optional(),
  LYNTAR_LIVE_TEST: z.enum(['0', '1']).default('0'),
  LYNTAR_MODEL_ID: z.string().min(1).optional(),
  LYNTAR_RAZORPAY_KEY_ID: z.string().min(1).optional(),
  LYNTAR_RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  LYNTAR_RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  LYNTAR_DEVELOPMENT_ENTITLEMENT: z.enum(['0', '1']).default('0'),
  LYNTAR_RESEND_API_KEY: z.string().min(1).optional(),
  LYNTAR_EMAIL_FROM: z.string().min(3).optional(),
  LYNTAR_PUBLIC_SITE_URL: z.string().url().optional(),
  LYNTAR_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  LYNTAR_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  LYNTAR_GOOGLE_REDIRECT_URI: z.string().url().optional(),
  LYNTAR_GOOGLE_DESKTOP_CALLBACK_URI: z
    .string()
    .url()
    .or(z.string().startsWith('astra://'))
    .default('astra://auth/callback'),
  LYNTAR_SECURE_COOKIES: z.enum(['0', '1']).default('0'),
  LYNTAR_SUPERADMIN_EMAIL: z.string().email().optional(),
  LYNTAR_SUPERADMIN_PASSWORD_HASH: z.string().min(1).optional(),
  LYNTAR_RELAY_SECRET: z.string().min(32).optional(),
  LYNTAR_RELAY_REQUIRE_TLS: z.enum(['0', '1']).default('1'),
});

export interface LyntarConfig {
  apiPort: number;
  databaseUrl?: string;
  modelGatewayBaseUrl?: string;
  modelGatewayApiKey?: string;
  runtimeTokenSecret?: string;
  liveTestsEnabled: boolean;
  modelId?: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  developmentEntitlement: boolean;
  resendApiKey?: string;
  emailFrom?: string;
  publicSiteUrl?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  googleDesktopCallbackUri: string;
  secureCookies: boolean;
  superAdminEmail?: string;
  superAdminPasswordHash?: string;
  relaySecret?: string;
  relayRequireTls: boolean;
}

/**
 * Production must never silently fall back to in-memory state or an
 * unconfigured gateway. Development and test callers intentionally use the
 * deterministic adapters, so this gate is applied by the production server
 * entrypoint rather than by `loadConfig` itself.
 */
export function assertProductionConfiguration(
  config: LyntarConfig,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const runtime = environment.LYNTAR_RUNTIME_ENV ?? environment.NODE_ENV ?? 'development';
  if (runtime !== 'production') return;
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('LYNTAR_DATABASE_URL');
  if (!config.modelGatewayBaseUrl) missing.push('LYNTAR_MODEL_GATEWAY_URL');
  if (!config.modelGatewayApiKey) missing.push('LYNTAR_MODEL_GATEWAY_API_KEY');
  if (!config.runtimeTokenSecret) missing.push('LYNTAR_RUNTIME_TOKEN_SECRET');
  if (!config.secureCookies) missing.push('LYNTAR_SECURE_COOKIES=1');
  if (config.developmentEntitlement) missing.push('LYNTAR_DEVELOPMENT_ENTITLEMENT=0');
  if (!config.razorpayKeyId) missing.push('LYNTAR_RAZORPAY_KEY_ID');
  if (!config.razorpayKeySecret) missing.push('LYNTAR_RAZORPAY_KEY_SECRET');
  if (!config.razorpayWebhookSecret) missing.push('LYNTAR_RAZORPAY_WEBHOOK_SECRET');
  if (!config.resendApiKey) missing.push('LYNTAR_RESEND_API_KEY');
  if (!config.emailFrom) missing.push('LYNTAR_EMAIL_FROM');
  if (!config.publicSiteUrl) missing.push('LYNTAR_PUBLIC_SITE_URL');
  if (!config.googleClientId) missing.push('LYNTAR_GOOGLE_CLIENT_ID');
  if (!config.googleClientSecret) missing.push('LYNTAR_GOOGLE_CLIENT_SECRET');
  if (!config.googleRedirectUri) missing.push('LYNTAR_GOOGLE_REDIRECT_URI');
  if (!config.relaySecret) missing.push('LYNTAR_RELAY_SECRET');
  if (missing.length > 0)
    throw new Error(`Production configuration is incomplete: ${missing.join(', ')}`);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): LyntarConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    apiPort: Number(parsed.LYNTAR_API_PORT),
    ...(parsed.LYNTAR_DATABASE_URL === undefined
      ? {}
      : { databaseUrl: parsed.LYNTAR_DATABASE_URL }),
    ...(parsed.LYNTAR_MODEL_GATEWAY_URL === undefined
      ? {}
      : { modelGatewayBaseUrl: parsed.LYNTAR_MODEL_GATEWAY_URL }),
    ...(parsed.LYNTAR_MODEL_GATEWAY_API_KEY === undefined
      ? {}
      : { modelGatewayApiKey: parsed.LYNTAR_MODEL_GATEWAY_API_KEY }),
    ...(parsed.LYNTAR_RUNTIME_TOKEN_SECRET === undefined
      ? {}
      : { runtimeTokenSecret: parsed.LYNTAR_RUNTIME_TOKEN_SECRET }),
    liveTestsEnabled: parsed.LYNTAR_LIVE_TEST === '1',
    ...(parsed.LYNTAR_MODEL_ID === undefined ? {} : { modelId: parsed.LYNTAR_MODEL_ID }),
    ...(parsed.LYNTAR_RAZORPAY_KEY_ID === undefined
      ? {}
      : { razorpayKeyId: parsed.LYNTAR_RAZORPAY_KEY_ID }),
    ...(parsed.LYNTAR_RAZORPAY_KEY_SECRET === undefined
      ? {}
      : { razorpayKeySecret: parsed.LYNTAR_RAZORPAY_KEY_SECRET }),
    ...(parsed.LYNTAR_RAZORPAY_WEBHOOK_SECRET === undefined
      ? {}
      : { razorpayWebhookSecret: parsed.LYNTAR_RAZORPAY_WEBHOOK_SECRET }),
    developmentEntitlement: parsed.LYNTAR_DEVELOPMENT_ENTITLEMENT === '1',
    ...(parsed.LYNTAR_RESEND_API_KEY === undefined
      ? {}
      : { resendApiKey: parsed.LYNTAR_RESEND_API_KEY }),
    ...(parsed.LYNTAR_EMAIL_FROM === undefined ? {} : { emailFrom: parsed.LYNTAR_EMAIL_FROM }),
    ...(parsed.LYNTAR_PUBLIC_SITE_URL === undefined
      ? {}
      : { publicSiteUrl: parsed.LYNTAR_PUBLIC_SITE_URL }),
    ...(parsed.LYNTAR_GOOGLE_CLIENT_ID === undefined
      ? {}
      : { googleClientId: parsed.LYNTAR_GOOGLE_CLIENT_ID }),
    ...(parsed.LYNTAR_GOOGLE_CLIENT_SECRET === undefined
      ? {}
      : { googleClientSecret: parsed.LYNTAR_GOOGLE_CLIENT_SECRET }),
    ...(parsed.LYNTAR_GOOGLE_REDIRECT_URI === undefined
      ? {}
      : { googleRedirectUri: parsed.LYNTAR_GOOGLE_REDIRECT_URI }),
    googleDesktopCallbackUri: parsed.LYNTAR_GOOGLE_DESKTOP_CALLBACK_URI,
    secureCookies: parsed.LYNTAR_SECURE_COOKIES === '1',
    ...(parsed.LYNTAR_SUPERADMIN_EMAIL === undefined
      ? {}
      : { superAdminEmail: parsed.LYNTAR_SUPERADMIN_EMAIL }),
    ...(parsed.LYNTAR_SUPERADMIN_PASSWORD_HASH === undefined
      ? {}
      : { superAdminPasswordHash: parsed.LYNTAR_SUPERADMIN_PASSWORD_HASH }),
    ...(parsed.LYNTAR_RELAY_SECRET === undefined
      ? {}
      : { relaySecret: parsed.LYNTAR_RELAY_SECRET }),
    relayRequireTls: parsed.LYNTAR_RELAY_REQUIRE_TLS === '1',
  };
}
