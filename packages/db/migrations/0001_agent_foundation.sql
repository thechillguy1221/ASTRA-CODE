CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  local_display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES agent_sessions(id),
  state text NOT NULL,
  prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS model_catalog (
  model_id text PRIMARY KEY,
  display_name text NOT NULL,
  gateway_model_id text NOT NULL,
  provider_slug text NOT NULL,
  provider text,
  enabled boolean NOT NULL DEFAULT false,
  visible boolean NOT NULL DEFAULT true,
  context_window integer,
  capabilities jsonb NOT NULL,
  cost_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  pricing_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS context_window integer;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS cost_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS pricing_verified_at timestamptz;
UPDATE model_catalog SET provider = provider_slug WHERE provider IS NULL;

CREATE TABLE IF NOT EXISTS usage_receipts (
  id uuid PRIMARY KEY,
  request_id text NOT NULL UNIQUE,
  -- Task IDs originate in the local desktop runtime during the first slice.
  -- Keep the receipt durable before authenticated server task/session ownership exists.
  task_id text NOT NULL,
  agent_task_id text,
  agent_session_id text,
  model_id text NOT NULL REFERENCES model_catalog(model_id),
  gateway_request_id text,
  gateway_model_id text,
  provider text,
  provider_route text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  cache_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  reasoning_units numeric(20, 6),
  other_billable_units numeric(20, 6),
  actual_cost_usd numeric(20, 10),
  calculated_expected_cost_usd numeric(20, 10),
  cost_difference_usd numeric(20, 10),
  billing_anomaly boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS agent_task_id text;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS agent_session_id text;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS gateway_request_id text;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS gateway_model_id text;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS cache_read_tokens integer;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS cache_write_tokens integer;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS reasoning_units numeric(20, 6);
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS other_billable_units numeric(20, 6);
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS calculated_expected_cost_usd numeric(20, 10);
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS cost_difference_usd numeric(20, 10);
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS billing_anomaly boolean NOT NULL DEFAULT false;
ALTER TABLE usage_receipts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS usage_receipts_gateway_request_id_uq
  ON usage_receipts(gateway_request_id)
  WHERE gateway_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_events (
  event_id text PRIMARY KEY,
  task_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_events_task_id_occurred_at_idx
  ON agent_events(task_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS credit_ledger_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  task_id uuid REFERENCES agent_tasks(id),
  amount_credits numeric(20, 6) NOT NULL,
  transaction_type text NOT NULL DEFAULT 'ADJUSTMENT'
    CHECK (transaction_type IN (
      'CREDIT_PURCHASE', 'SUBSCRIPTION_GRANT', 'PROMO_CREDIT', 'USAGE_RESERVE',
      'USAGE_SETTLEMENT', 'RESERVE_RELEASE', 'REFUND', 'ADJUSTMENT'
    )),
  idempotency_key text UNIQUE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credit_ledger_entries
  ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'ADJUSTMENT';
ALTER TABLE credit_ledger_entries ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_transaction_type_chk'
  ) THEN
    ALTER TABLE credit_ledger_entries
      ADD CONSTRAINT credit_ledger_transaction_type_chk CHECK (transaction_type IN (
        'CREDIT_PURCHASE', 'SUBSCRIPTION_GRANT', 'PROMO_CREDIT', 'USAGE_RESERVE',
        'USAGE_SETTLEMENT', 'RESERVE_RELEASE', 'REFUND', 'ADJUSTMENT'
      ));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_credit_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credit ledger entries are append-only; use a compensating entry';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'credit_ledger_entries_no_update'
  ) THEN
    CREATE TRIGGER credit_ledger_entries_no_update
      BEFORE UPDATE ON credit_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_mutation();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'credit_ledger_entries_no_delete'
  ) THEN
    CREATE TRIGGER credit_ledger_entries_no_delete
      BEFORE DELETE ON credit_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_mutation();
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS usage_receipts_task_id_idx ON usage_receipts(task_id);
CREATE INDEX IF NOT EXISTS agent_tasks_session_id_idx ON agent_tasks(session_id);
