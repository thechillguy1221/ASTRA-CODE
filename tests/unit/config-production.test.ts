import { describe, expect, it } from 'vitest';
import { assertProductionConfiguration, loadConfig } from '@astra/config';

describe('production configuration guard', () => {
  it('rejects an in-memory/incomplete production server configuration', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    expect(() => assertProductionConfiguration(config, { NODE_ENV: 'production' })).toThrow(
      /ASTRA_DATABASE_URL/,
    );
  });

  it('does not block deterministic development configuration', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(() => assertProductionConfiguration(config, { NODE_ENV: 'development' })).not.toThrow();
  });

  it('rejects production when a shipped external service would silently downgrade', () => {
    const environment = {
      NODE_ENV: 'production',
      ASTRA_DATABASE_URL: 'postgres://astra:secret@example.test/astra',
      ASTRA_MODEL_GATEWAY_URL: 'https://gateway.example.test',
      ASTRA_MODEL_GATEWAY_API_KEY: 'gateway-secret',
      ASTRA_SECURE_COOKIES: '1',
      ASTRA_DEVELOPMENT_ENTITLEMENT: '0',
    };
    const config = loadConfig(environment);
    expect(() => assertProductionConfiguration(config, environment)).toThrow(
      /ASTRA_RESEND_API_KEY/,
    );
  });

  it('accepts a complete production service configuration', () => {
    const environment = {
      NODE_ENV: 'production',
      ASTRA_DATABASE_URL: 'postgres://astra:secret@example.test/astra',
      ASTRA_MODEL_GATEWAY_URL: 'https://gateway.example.test',
      ASTRA_MODEL_GATEWAY_API_KEY: 'gateway-secret',
      ASTRA_SECURE_COOKIES: '1',
      ASTRA_DEVELOPMENT_ENTITLEMENT: '0',
      ASTRA_RUNTIME_TOKEN_SECRET: 'runtime-token-secret-with-at-least-32-bytes-123',
      ASTRA_RAZORPAY_KEY_ID: 'rzp_test_key',
      ASTRA_RAZORPAY_KEY_SECRET: 'razorpay-secret',
      ASTRA_RAZORPAY_WEBHOOK_SECRET: 'razorpay-webhook-secret',
      ASTRA_RESEND_API_KEY: 're_test_email_key',
      ASTRA_EMAIL_FROM: 'Astra Code <noreply@example.test>',
      ASTRA_PUBLIC_SITE_URL: 'https://astra.example.test',
      ASTRA_GOOGLE_CLIENT_ID: 'google-client-id',
      ASTRA_GOOGLE_CLIENT_SECRET: 'google-client-secret',
      ASTRA_GOOGLE_REDIRECT_URI: 'https://astra.example.test/v1/auth/google/callback',
      ASTRA_RELAY_SECRET: 'relay-secret-with-at-least-32-characters-123',
    };
    const config = loadConfig(environment);
    expect(() => assertProductionConfiguration(config, environment)).not.toThrow();
  });
});
