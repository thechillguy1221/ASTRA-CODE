-- Astra commercial matrix and controlled personal/team remote access.
-- This is a forward migration. Historical migration identifiers remain unchanged.

INSERT INTO plans (id, display_name, monthly_price_inr, monthly_credits, entitlements, enabled)
VALUES
  ('FREE', 'Free', 0, 25,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"25","maxConcurrentJobs":1,"mcpLimit":0,"pluginLimit":0,"premiumModeAccess":false,"maxContextWindow":128000,"priority":"standard","seats":1,"activeJobsPerSeat":1,"pooledCredits":false,"crossPersonRooms":false,"rolloverCycles":1,"topUpEnabled":false}'::jsonb,
   true),
  ('BASIC', 'Basic', 499, 300,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"300","maxConcurrentJobs":3,"mcpLimit":5,"pluginLimit":5,"premiumModeAccess":true,"maxContextWindow":128000,"priority":"priority","seats":1,"activeJobsPerSeat":3,"pooledCredits":false,"crossPersonRooms":false,"rolloverCycles":1,"topUpEnabled":true}'::jsonb,
   true),
  ('PRO', 'Pro', 999, 600,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"600","maxConcurrentJobs":5,"mcpLimit":20,"pluginLimit":20,"premiumModeAccess":true,"maxContextWindow":256000,"priority":"priority","seats":1,"activeJobsPerSeat":5,"pooledCredits":false,"crossPersonRooms":false,"rolloverCycles":1,"topUpEnabled":true}'::jsonb,
   true),
  ('MAX', 'Max', 1999, 1200,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"1200","maxConcurrentJobs":10,"mcpLimit":100,"pluginLimit":100,"premiumModeAccess":true,"maxContextWindow":1000000,"priority":"highest","seats":1,"activeJobsPerSeat":10,"pooledCredits":false,"crossPersonRooms":false,"rolloverCycles":1,"topUpEnabled":true}'::jsonb,
   true),
  ('TEAM', 'Team', 9999, 6000,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"1200","maxConcurrentJobs":50,"mcpLimit":100,"pluginLimit":100,"premiumModeAccess":true,"maxContextWindow":1000000,"priority":"highest","seats":5,"activeJobsPerSeat":10,"pooledCredits":true,"crossPersonRooms":true,"rolloverCycles":1,"topUpEnabled":true}'::jsonb,
   true),
  ('BUSINESS', 'Business', 19999, 12000,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"2400","maxConcurrentJobs":100,"mcpLimit":100,"pluginLimit":100,"premiumModeAccess":true,"maxContextWindow":1000000,"priority":"highest","seats":10,"activeJobsPerSeat":10,"pooledCredits":true,"crossPersonRooms":true,"rolloverCycles":1,"topUpEnabled":true}'::jsonb,
   true)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  monthly_price_inr = EXCLUDED.monthly_price_inr,
  monthly_credits = EXCLUDED.monthly_credits,
  entitlements = EXCLUDED.entitlements,
  enabled = EXCLUDED.enabled,
  updated_at = now();

-- Legacy paid identifiers are mapped before they are removed. Existing user,
-- subscription, and billing-period references therefore remain valid.
UPDATE users SET plan_id = 'BASIC' WHERE plan_id IN ('STUDENT', 'BUILDER');
UPDATE subscriptions SET plan_id = 'BASIC' WHERE plan_id IN ('STUDENT', 'BUILDER');
UPDATE billing_periods SET plan_id = 'BASIC' WHERE plan_id IN ('STUDENT', 'BUILDER');
DELETE FROM plans
WHERE id IN ('STUDENT', 'BUILDER')
  AND NOT EXISTS (SELECT 1 FROM users WHERE plan_id IN ('STUDENT', 'BUILDER'))
  AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_id IN ('STUDENT', 'BUILDER'))
  AND NOT EXISTS (SELECT 1 FROM billing_periods WHERE plan_id IN ('STUDENT', 'BUILDER'));

ALTER TABLE wallet_buckets DROP CONSTRAINT IF EXISTS wallet_buckets_source_type_check;
ALTER TABLE wallet_buckets ADD CONSTRAINT wallet_buckets_source_type_check CHECK (
  source_type IN (
    'free_monthly', 'subscription_monthly', 'purchased_topup', 'promotional',
    'referral', 'refund_adjustment', 'admin_adjustment',
    'SUBSCRIPTION_GRANT', 'CREDIT_PURCHASE', 'PROMO_CREDIT', 'ADJUSTMENT'
  )
);
ALTER TABLE wallet_buckets ADD COLUMN IF NOT EXISTS rollover_cycle integer NOT NULL DEFAULT 0;
ALTER TABLE wallet_buckets ADD COLUMN IF NOT EXISTS expired_at timestamptz;
ALTER TABLE wallet_buckets ADD COLUMN IF NOT EXISTS reference_id text;
ALTER TABLE wallet_buckets ADD COLUMN IF NOT EXISTS plan_cycle text;
ALTER TABLE wallet_buckets ADD COLUMN IF NOT EXISTS idempotency_key text;
UPDATE wallet_buckets SET idempotency_key = id::text WHERE idempotency_key IS NULL;
ALTER TABLE wallet_buckets ALTER COLUMN idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_buckets_idempotency_uq ON wallet_buckets(idempotency_key);
ALTER TABLE credit_reservations ADD COLUMN IF NOT EXISTS bucket_allocations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE credit_reservations ADD COLUMN IF NOT EXISTS model_id text;

CREATE TABLE IF NOT EXISTS top_up_skus (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  credits numeric(20, 7) NOT NULL CHECK (credits > 0),
  price_inr numeric(20, 2) NOT NULL CHECK (price_inr >= 0),
  validity_days integer NOT NULL CHECK (validity_days > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO top_up_skus (id, display_name, credits, price_inr, validity_days)
VALUES ('TOPUP_250', '250 credits', 250, 499, 365)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  credits = EXCLUDED.credits,
  price_inr = EXCLUDED.price_inr,
  validity_days = EXCLUDED.validity_days,
  updated_at = now();

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  plan_id text NOT NULL REFERENCES plans(id),
  display_name text NOT NULL,
  seat_limit integer NOT NULL DEFAULT 1 CHECK (seat_limit > 0),
  pooled_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (pooled_credits >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_limit integer NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pooled_credits numeric(20, 7) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'AGENT_USER', 'VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  invited_at timestamptz,
  joined_at timestamptz,
  suspended_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members(user_id, status);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  host_user_id uuid NOT NULL REFERENCES users(id),
  host_device_id uuid NOT NULL REFERENCES remote_devices(id),
  name text NOT NULL,
  workspace_root_relative text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rooms_org_idx ON rooms(organization_id, status);

CREATE TABLE IF NOT EXISTS room_invitations (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  redeemed_by uuid REFERENCES users(id),
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_invitations_email_idx ON room_invitations(invited_email, expires_at);

CREATE TABLE IF NOT EXISTS room_audit_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  room_id uuid REFERENCES rooms(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_audit_room_idx ON room_audit_events(room_id, created_at DESC);

ALTER TABLE remote_devices ADD COLUMN IF NOT EXISTS credential_version integer NOT NULL DEFAULT 1;
ALTER TABLE remote_devices ADD COLUMN IF NOT EXISTS architecture text NOT NULL DEFAULT 'unknown';
ALTER TABLE remote_devices ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
ALTER TABLE remote_relay_sessions ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
ALTER TABLE remote_relay_sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE remote_relay_sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_reservations ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE credit_reservations ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES rooms(id);
ALTER TABLE credit_reservations ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES users(id);
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES rooms(id);
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES remote_devices(id);
