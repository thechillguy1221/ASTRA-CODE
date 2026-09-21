import { describe, expect, it } from 'vitest';
import { assertProductionConfiguration, loadConfig } from '@lyntar/config';

describe('production configuration guard', () => {
  it('rejects an in-memory/incomplete production server configuration', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    expect(() => assertProductionConfiguration(config, { NODE_ENV: 'production' })).toThrow(
      /LYNTAR_DATABASE_URL/,
    );
  });

  it('does not block deterministic development configuration', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(() => assertProductionConfiguration(config, { NODE_ENV: 'development' })).not.toThrow();
  });

  it('rejects production when a shipped external service would silently downgrade', () => {
    const environment = {
      NODE_ENV: 'production',
      LYNTAR_DATABASE_URL: 'postgres://astra:secret@example.test/astra',
      LYNTAR_MODEL_GATEWAY_URL: 'https://gateway.example.test',
      LYNTAR_MODEL_GATEWAY_API_KEY: 'gateway-secret',
      LYNTAR_SECURE_COOKIES: '1',
      LYNTAR_DEVELOPMENT_ENTITLEMENT: '0',
    };
    const config = loadConfig(environment);
    expect(() => assertProductionConfiguration(config, environment)).toThrow(
      /LYNTAR_RESEND_API_KEY/,
    );
  });

  it('accepts a complete production service configuration', () => {
    const environment = {
      NODE_ENV: 'production',
      LYNTAR_DATABASE_URL: 'postgres://astra:secret@example.test/astra',
      LYNTAR_MODEL_GATEWAY_URL: 'https://gateway.example.test',
      LYNTAR_MODEL_GATEWAY_API_KEY: 'gateway-secret',
      LYNTAR_SECURE_COOKIES: '1',
      LYNTAR_DEVELOPMENT_ENTITLEMENT: '0',
      LYNTAR_RUNTIME_TOKEN_SECRET: 'runtime-token-secret-with-at-least-32-bytes-123',
      LYNTAR_RAZORPAY_KEY_ID: 'rzp_test_key',
      LYNTAR_RAZORPAY_KEY_SECRET: 'razorpay-secret',
      LYNTAR_RAZORPAY_WEBHOOK_SECRET: 'razorpay-webhook-secret',
      LYNTAR_RESEND_API_KEY: 're_test_email_key',
      LYNTAR_EMAIL_FROM: 'Astra Code <noreply@example.test>',
      LYNTAR_PUBLIC_SITE_URL: 'https://astra.example.test',
      LYNTAR_GOOGLE_CLIENT_ID: 'google-client-id',
      LYNTAR_GOOGLE_CLIENT_SECRET: 'google-client-secret',
      LYNTAR_GOOGLE_REDIRECT_URI: 'https://astra.example.test/v1/auth/google/callback',
      LYNTAR_RELAY_SECRET: 'relay-secret-with-at-least-32-characters-123',
    };
    const config = loadConfig(environment);
    expect(() => assertProductionConfiguration(config, environment)).not.toThrow();
  });
});
