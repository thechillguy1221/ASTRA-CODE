-- Organization-scoped pooled wallet accounting.
-- Personal wallets remain in wallets/credit_reservations. These tables keep
-- organization funds and member/Room attribution isolated and auditable.

CREATE TABLE IF NOT EXISTS organization_wallets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  available_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  reserved_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  consumed_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (consumed_credits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_wallet_buckets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN (
    'free_monthly', 'subscription_monthly', 'purchased_topup', 'promotional',
    'referral', 'refund_adjustment', 'admin_adjustment', 'SUBSCRIPTION_GRANT',
    'CREDIT_PURCHASE', 'PROMO_CREDIT', 'ADJUSTMENT'
  )),
  original_credits numeric(20, 7) NOT NULL CHECK (original_credits >= 0),
  available_credits numeric(20, 7) NOT NULL CHECK (available_credits >= 0),
  reserved_credits numeric(20, 7) NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL UNIQUE,
  reference_id text,
  plan_cycle text
);
CREATE INDEX IF NOT EXISTS organization_wallet_buckets_org_idx
  ON organization_wallet_buckets(organization_id, expires_at, created_at);

CREATE TABLE IF NOT EXISTS organization_credit_ledger_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  room_id uuid REFERENCES rooms(id),
  task_key text,
  amount_credits numeric(20, 7) NOT NULL CHECK (amount_credits >= 0),
  transaction_type text NOT NULL CHECK (transaction_type IN (
    'CREDIT_PURCHASE', 'SUBSCRIPTION_GRANT', 'PROMO_CREDIT', 'USAGE_RESERVE',
    'USAGE_SETTLEMENT', 'RESERVE_RELEASE', 'REFUND', 'ADJUSTMENT'
  )),
  idempotency_key text NOT NULL,
  reason text NOT NULL,
  available_delta_credits numeric(20, 7) NOT NULL DEFAULT 0,
  reserved_delta_credits numeric(20, 7) NOT NULL DEFAULT 0,
  consumed_delta_credits numeric(20, 7) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS organization_credit_ledger_org_idx
  ON organization_credit_ledger_entries(organization_id, created_at ASC, id ASC);

CREATE OR REPLACE FUNCTION prevent_organization_credit_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'organization credit ledger entries are append-only; use a compensating entry';
END;
$$;

DROP TRIGGER IF EXISTS organization_credit_ledger_entries_no_update
  ON organization_credit_ledger_entries;
CREATE TRIGGER organization_credit_ledger_entries_no_update
  BEFORE UPDATE ON organization_credit_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_credit_ledger_mutation();

DROP TRIGGER IF EXISTS organization_credit_ledger_entries_no_delete
  ON organization_credit_ledger_entries;
CREATE TRIGGER organization_credit_ledger_entries_no_delete
  BEFORE DELETE ON organization_credit_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_credit_ledger_mutation();

CREATE TABLE IF NOT EXISTS organization_credit_reservations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  room_id uuid REFERENCES rooms(id),
  host_device_id uuid REFERENCES remote_devices(id),
  task_key text NOT NULL,
  model_id text,
  amount_credits numeric(20, 7) NOT NULL CHECK (amount_credits >= 0),
  status text NOT NULL CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED', 'CANCELLED')),
  idempotency_key text NOT NULL,
  bucket_allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS organization_credit_reservations_org_status_idx
  ON organization_credit_reservations(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS organization_usage_settlements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL UNIQUE REFERENCES organization_credit_reservations(id),
  provider_actual_cost_usd numeric(20, 10) NOT NULL CHECK (provider_actual_cost_usd >= 0),
  customer_billable_cost_usd numeric(20, 10) NOT NULL CHECK (customer_billable_cost_usd >= 0),
  absorbed_cost_usd numeric(20, 10) NOT NULL CHECK (absorbed_cost_usd >= 0),
  reserved_credits numeric(20, 7) NOT NULL,
  settled_credits numeric(20, 7) NOT NULL,
  released_credits numeric(20, 7) NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

-- Preserve any legacy organization pooled balance in an auditable migration
-- entry. Existing organizations use their own ID as the deterministic wallet
-- ID; no new provider or customer data is invented.
INSERT INTO organization_wallets
  (id, organization_id, available_credits, reserved_credits, consumed_credits)
SELECT id, id, pooled_credits, 0, 0
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM organization_wallets wallets
  WHERE wallets.organization_id = organizations.id
);

INSERT INTO organization_credit_ledger_entries
  (id, organization_id, actor_user_id, task_key, amount_credits, transaction_type,
   idempotency_key, reason, available_delta_credits, metadata)
SELECT id, id, owner_user_id, NULL, pooled_credits, 'ADJUSTMENT',
       'migration:0011:legacy-pooled-balance:' || id::text,
       'Migrate legacy pooled organization balance into isolated wallet',
       pooled_credits,
       jsonb_build_object('migration', '0011_organization_wallets')
FROM organizations
WHERE pooled_credits > 0
  AND NOT EXISTS (
    SELECT 1 FROM organization_credit_ledger_entries entries
    WHERE entries.organization_id = organizations.id
      AND entries.idempotency_key = 'migration:0011:legacy-pooled-balance:' || organizations.id::text
  );

-- Reservation critical section: SELECT ... FROM organization_wallets
-- WHERE organization_id = $1 FOR UPDATE;
