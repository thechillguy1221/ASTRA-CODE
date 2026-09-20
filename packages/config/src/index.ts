import { z } from 'zod';
export * from './flags.js';

const EnvironmentSchema = z.object({
  LYNTAR_API_PORT: z.string().regex(/^\d+$/).default('4317'),
  LYNTAR_DATABASE_URL: z.string().url().optional(),
  LYNTAR_MODEL_GATEWAY_URL: z.string().url().optional(),
  LYNTAR_MODEL_GATEWAY_API_KEY: z.string().min(1).optional(),
  LYNTAR_LIVE_TEST: z.enum(['0', '1']).default('0'),
  LYNTAR_MODEL_ID: z.string().min(1).optional(),
  LYNTAR_RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  LYNTAR_DEVELOPMENT_ENTITLEMENT: z.enum(['0', '1']).default('0'),
});

export interface LyntarConfig {
  apiPort: number;
  databaseUrl?: string;
  modelGatewayBaseUrl?: string;
  modelGatewayApiKey?: string;
  liveTestsEnabled: boolean;
  modelId?: string;
  razorpayWebhookSecret?: string;
  developmentEntitlement: boolean;
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
    liveTestsEnabled: parsed.LYNTAR_LIVE_TEST === '1',
    ...(parsed.LYNTAR_MODEL_ID === undefined ? {} : { modelId: parsed.LYNTAR_MODEL_ID }),
    ...(parsed.LYNTAR_RAZORPAY_WEBHOOK_SECRET === undefined
      ? {}
      : { razorpayWebhookSecret: parsed.LYNTAR_RAZORPAY_WEBHOOK_SECRET }),
    developmentEntitlement: parsed.LYNTAR_DEVELOPMENT_ENTITLEMENT === '1',
  };
}
