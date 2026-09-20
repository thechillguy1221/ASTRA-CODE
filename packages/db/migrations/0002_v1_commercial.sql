-- V1 commercial/auth schema. No seed balances or fake payment rows are inserted.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
UPDATE users SET email = id::text WHERE email IS NULL;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users(email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_verifier text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'USER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id text NOT NULL DEFAULT 'FREE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_chk CHECK (status IN ('ACTIVE', 'DISABLED'));
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('USER', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  device_label text NOT NULL,
  platform text NOT NULL,
  architecture text NOT NULL,
  desktop_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_sessions_user_idx ON device_sessions(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  device_session_id uuid NOT NULL REFERENCES device_sessions(id),
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  monthly_price_inr numeric(20, 2) NOT NULL,
  monthly_credits numeric(20, 7) NOT NULL,
  entitlements jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plans (id, display_name, monthly_price_inr, monthly_credits, entitlements)
VALUES
  ('FREE', 'Free', 0, 50, '{"allowedModelIds":["approved-core"],"allowedModes":["BUILD","LEARN"],"maxTaskBudgetCredits":"25","maxConcurrentJobs":1,"mcpLimit":0,"pluginLimit":0,"premiumModeAccess":false,"maxContextWindow":128000,"priority":"standard"}'::jsonb),
  ('STUDENT', 'Student', 149, 500, '{"allowedModelIds":["approved-core","frontier"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"100","maxConcurrentJobs":2,"mcpLimit":5,"pluginLimit":5,"premiumModeAccess":true,"maxContextWindow":128000,"priority":"priority"}'::jsonb),
  ('PRO', 'Pro', 299, 1200, '{"allowedModelIds":["approved-core","frontier"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"250","maxConcurrentJobs":4,"mcpLimit":20,"pluginLimit":20,"premiumModeAccess":true,"maxContextWindow":256000,"priority":"priority"}'::jsonb),
  ('MAX', 'Max', 599, 2500, '{"allowedModelIds":["approved-core","frontier"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"500","maxConcurrentJobs":8,"mcpLimit":100,"pluginLimit":100,"premiumModeAccess":true,"maxContextWindow":1000000,"priority":"highest"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_plan_fk FOREIGN KEY (plan_id) REFERENCES plans(id);
  END IF;
END;
$$;

ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS family text;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS recommended boolean NOT NULL DEFAULT false;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS plan_access jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS max_reasoning numeric(20, 6);
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS routing_role text;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS fallback_model_id text;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS release_date date;

ALTER TABLE credit_ledger_entries ALTER COLUMN amount_credits TYPE numeric(20, 7) USING amount_credits;
ALTER TABLE credit_ledger_entries ADD COLUMN IF NOT EXISTS available_delta_credits numeric(20, 7) NOT NULL DEFAULT 0;
ALTER TABLE credit_ledger_entries ADD COLUMN IF NOT EXISTS reserved_delta_credits numeric(20, 7) NOT NULL DEFAULT 0;
ALTER TABLE credit_ledger_entries ADD COLUMN IF NOT EXISTS consumed_delta_credits numeric(20, 7) NOT NULL DEFAULT 0;
ALTER TABLE credit_ledger_entries ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE credit_ledger_entries ADD COLUMN IF NOT EXISTS task_key text;
UPDATE credit_ledger_entries SET task_key = task_id::text WHERE task_key IS NULL AND task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  available_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  reserved_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  consumed_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (consumed_credits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_buckets (
  id uuid PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  source_type text NOT NULL CHECK (source_type IN ('SUBSCRIPTION_GRANT', 'CREDIT_PURCHASE', 'PROMO_CREDIT', 'ADJUSTMENT')),
  original_credits numeric(20, 7) NOT NULL CHECK (original_credits >= 0),
  available_credits numeric(20, 7) NOT NULL CHECK (available_credits >= 0),
  reserved_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_buckets_wallet_idx ON wallet_buckets(wallet_id, expires_at, created_at);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  task_id uuid REFERENCES agent_tasks(id),
  amount_credits numeric(20, 7) NOT NULL CHECK (amount_credits >= 0),
  status text NOT NULL CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED', 'CANCELLED')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
ALTER TABLE credit_reservations ADD COLUMN IF NOT EXISTS task_key text;
UPDATE credit_reservations SET task_key = task_id::text WHERE task_key IS NULL AND task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS usage_settlements (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL UNIQUE REFERENCES credit_reservations(id),
  provider_actual_cost_usd numeric(20, 10) NOT NULL CHECK (provider_actual_cost_usd >= 0),
  customer_billable_cost_usd numeric(20, 10) NOT NULL CHECK (customer_billable_cost_usd >= 0),
  absorbed_cost_usd numeric(20, 10) NOT NULL CHECK (absorbed_cost_usd >= 0),
  reserved_credits numeric(20, 7) NOT NULL,
  settled_credits numeric(20, 7) NOT NULL,
  released_credits numeric(20, 7) NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_periods (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id text NOT NULL REFERENCES plans(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, plan_id, period_start)
);

CREATE TABLE IF NOT EXISTS subscription_credit_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  billing_period_id uuid NOT NULL REFERENCES billing_periods(id),
  ledger_entry_id uuid NOT NULL REFERENCES credit_ledger_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, billing_period_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  provider_subscription_id text NOT NULL UNIQUE,
  plan_id text NOT NULL REFERENCES plans(id),
  status text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  provider_payment_id text UNIQUE,
  provider_order_id text,
  amount_inr numeric(20, 2) NOT NULL,
  status text NOT NULL,
  failure_reason text,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  role text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  reason text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The real reservation repository runs this critical section inside a transaction:
-- SELECT ... FROM wallets WHERE user_id = $1 FOR UPDATE;
-- credit_ledger_entries_no_update remains the append-only financial guard.
