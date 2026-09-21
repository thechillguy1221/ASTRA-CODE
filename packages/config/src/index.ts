import { z } from 'zod';
export * from './flags.js';

const EnvironmentSchema = z.object({
  ASTRA_API_PORT: z.string().regex(/^\d+$/).default('4317'),
  ASTRA_DATABASE_URL: z.string().url().optional(),
  ASTRA_MODEL_GATEWAY_URL: z.string().url().optional(),
  ASTRA_MODEL_GATEWAY_API_KEY: z.string().min(1).optional(),
  ASTRA_RUNTIME_TOKEN_SECRET: z.string().min(32).optional(),
  ASTRA_LIVE_TEST: z.enum(['0', '1']).default('0'),
  ASTRA_MODEL_ID: z.string().min(1).optional(),
  ASTRA_RAZORPAY_KEY_ID: z.string().min(1).optional(),
  ASTRA_RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  ASTRA_RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  ASTRA_DEVELOPMENT_ENTITLEMENT: z.enum(['0', '1']).default('0'),
  ASTRA_RESEND_API_KEY: z.string().min(1).optional(),
  ASTRA_EMAIL_FROM: z.string().min(3).optional(),
  ASTRA_PUBLIC_SITE_URL: z.string().url().optional(),
  ASTRA_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  ASTRA_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  ASTRA_GOOGLE_REDIRECT_URI: z.string().url().optional(),
  ASTRA_GOOGLE_DESKTOP_CALLBACK_URI: z
    .string()
    .url()
    .or(z.string().startsWith('astra://'))
    .default('astra://auth/callback'),
  ASTRA_SECURE_COOKIES: z.enum(['0', '1']).default('0'),
  ASTRA_SUPERADMIN_EMAIL: z.string().email().optional(),
  ASTRA_SUPERADMIN_PASSWORD_HASH: z.string().min(1).optional(),
  ASTRA_RELAY_SECRET: z.string().min(32).optional(),
  ASTRA_RELAY_REQUIRE_TLS: z.enum(['0', '1']).default('1'),
});

export interface AstraConfig {
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
  config: AstraConfig,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const runtime = environment.ASTRA_RUNTIME_ENV ?? environment.NODE_ENV ?? 'development';
  if (runtime !== 'production') return;
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('ASTRA_DATABASE_URL');
  if (!config.modelGatewayBaseUrl) missing.push('ASTRA_MODEL_GATEWAY_URL');
  if (!config.modelGatewayApiKey) missing.push('ASTRA_MODEL_GATEWAY_API_KEY');
  if (!config.runtimeTokenSecret) missing.push('ASTRA_RUNTIME_TOKEN_SECRET');
  if (!config.secureCookies) missing.push('ASTRA_SECURE_COOKIES=1');
  if (config.developmentEntitlement) missing.push('ASTRA_DEVELOPMENT_ENTITLEMENT=0');
  if (!config.razorpayKeyId) missing.push('ASTRA_RAZORPAY_KEY_ID');
  if (!config.razorpayKeySecret) missing.push('ASTRA_RAZORPAY_KEY_SECRET');
  if (!config.razorpayWebhookSecret) missing.push('ASTRA_RAZORPAY_WEBHOOK_SECRET');
  if (!config.resendApiKey) missing.push('ASTRA_RESEND_API_KEY');
  if (!config.emailFrom) missing.push('ASTRA_EMAIL_FROM');
  if (!config.publicSiteUrl) missing.push('ASTRA_PUBLIC_SITE_URL');
  if (!config.googleClientId) missing.push('ASTRA_GOOGLE_CLIENT_ID');
  if (!config.googleClientSecret) missing.push('ASTRA_GOOGLE_CLIENT_SECRET');
  if (!config.googleRedirectUri) missing.push('ASTRA_GOOGLE_REDIRECT_URI');
  if (!config.relaySecret) missing.push('ASTRA_RELAY_SECRET');
  if (missing.length > 0)
    throw new Error(`Production configuration is incomplete: ${missing.join(', ')}`);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AstraConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    apiPort: Number(parsed.ASTRA_API_PORT),
    ...(parsed.ASTRA_DATABASE_URL === undefined ? {} : { databaseUrl: parsed.ASTRA_DATABASE_URL }),
    ...(parsed.ASTRA_MODEL_GATEWAY_URL === undefined
      ? {}
      : { modelGatewayBaseUrl: parsed.ASTRA_MODEL_GATEWAY_URL }),
    ...(parsed.ASTRA_MODEL_GATEWAY_API_KEY === undefined
      ? {}
      : { modelGatewayApiKey: parsed.ASTRA_MODEL_GATEWAY_API_KEY }),
    ...(parsed.ASTRA_RUNTIME_TOKEN_SECRET === undefined
      ? {}
      : { runtimeTokenSecret: parsed.ASTRA_RUNTIME_TOKEN_SECRET }),
    liveTestsEnabled: parsed.ASTRA_LIVE_TEST === '1',
    ...(parsed.ASTRA_MODEL_ID === undefined ? {} : { modelId: parsed.ASTRA_MODEL_ID }),
    ...(parsed.ASTRA_RAZORPAY_KEY_ID === undefined
      ? {}
      : { razorpayKeyId: parsed.ASTRA_RAZORPAY_KEY_ID }),
    ...(parsed.ASTRA_RAZORPAY_KEY_SECRET === undefined
      ? {}
      : { razorpayKeySecret: parsed.ASTRA_RAZORPAY_KEY_SECRET }),
    ...(parsed.ASTRA_RAZORPAY_WEBHOOK_SECRET === undefined
      ? {}
      : { razorpayWebhookSecret: parsed.ASTRA_RAZORPAY_WEBHOOK_SECRET }),
    developmentEntitlement: parsed.ASTRA_DEVELOPMENT_ENTITLEMENT === '1',
    ...(parsed.ASTRA_RESEND_API_KEY === undefined
      ? {}
      : { resendApiKey: parsed.ASTRA_RESEND_API_KEY }),
    ...(parsed.ASTRA_EMAIL_FROM === undefined ? {} : { emailFrom: parsed.ASTRA_EMAIL_FROM }),
    ...(parsed.ASTRA_PUBLIC_SITE_URL === undefined
      ? {}
      : { publicSiteUrl: parsed.ASTRA_PUBLIC_SITE_URL }),
    ...(parsed.ASTRA_GOOGLE_CLIENT_ID === undefined
      ? {}
      : { googleClientId: parsed.ASTRA_GOOGLE_CLIENT_ID }),
    ...(parsed.ASTRA_GOOGLE_CLIENT_SECRET === undefined
      ? {}
      : { googleClientSecret: parsed.ASTRA_GOOGLE_CLIENT_SECRET }),
    ...(parsed.ASTRA_GOOGLE_REDIRECT_URI === undefined
      ? {}
      : { googleRedirectUri: parsed.ASTRA_GOOGLE_REDIRECT_URI }),
    googleDesktopCallbackUri: parsed.ASTRA_GOOGLE_DESKTOP_CALLBACK_URI,
    secureCookies: parsed.ASTRA_SECURE_COOKIES === '1',
    ...(parsed.ASTRA_SUPERADMIN_EMAIL === undefined
      ? {}
      : { superAdminEmail: parsed.ASTRA_SUPERADMIN_EMAIL }),
    ...(parsed.ASTRA_SUPERADMIN_PASSWORD_HASH === undefined
      ? {}
      : { superAdminPasswordHash: parsed.ASTRA_SUPERADMIN_PASSWORD_HASH }),
    ...(parsed.ASTRA_RELAY_SECRET === undefined ? {} : { relaySecret: parsed.ASTRA_RELAY_SECRET }),
    relayRequireTls: parsed.ASTRA_RELAY_REQUIRE_TLS === '1',
  };
}
