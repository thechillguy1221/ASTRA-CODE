-- Astra identity, OTP, email preferences, delivery, and admin analytics foundation.
-- Existing Astra identifiers remain for migration compatibility.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk;
ALTER TABLE users ADD CONSTRAINT users_role_chk
  CHECK (role IN ('USER', 'ADMIN', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT'));

CREATE TABLE IF NOT EXISTS identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  subject text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user_idx ON identities(user_id);

CREATE TABLE IF NOT EXISTS email_verification_otps (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  sent_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_verification_otps_user_idx
  ON email_verification_otps(user_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS marketing_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  marketing_allowed boolean NOT NULL DEFAULT false,
  unsubscribed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('transactional', 'marketing')),
  template_id text NOT NULL,
  provider text NOT NULL,
  provider_message_id text,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_events_user_idx ON email_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_templates (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('transactional', 'marketing')),
  subject text NOT NULL,
  html text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  subject text NOT NULL,
  preview_text text NOT NULL DEFAULT '',
  html text NOT NULL,
  audience jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED')),
  scheduled_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED')),
  provider_message_id text,
  error_code text,
  sent_at timestamptz,
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_receipts_provider_model_idx
  ON usage_receipts(provider, model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON credit_ledger_entries(user_id, created_at DESC);
