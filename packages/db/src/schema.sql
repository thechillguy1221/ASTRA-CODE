CREATE TABLE users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  local_display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_tasks (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES agent_sessions(id),
  state text NOT NULL,
  prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE model_catalog (
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

CREATE TABLE usage_receipts (
  id uuid PRIMARY KEY,
  request_id text NOT NULL UNIQUE,
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

CREATE UNIQUE INDEX usage_receipts_gateway_request_id_uq
  ON usage_receipts(gateway_request_id)
  WHERE gateway_request_id IS NOT NULL;

CREATE TABLE agent_events (
  event_id text PRIMARY KEY,
  task_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX agent_events_task_id_occurred_at_idx
  ON agent_events(task_id, occurred_at ASC);

CREATE TABLE credit_ledger_entries (
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

CREATE OR REPLACE FUNCTION prevent_credit_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credit ledger entries are append-only; use a compensating entry';
END;
$$;

CREATE TRIGGER credit_ledger_entries_no_update
  BEFORE UPDATE ON credit_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_mutation();

CREATE TRIGGER credit_ledger_entries_no_delete
  BEFORE DELETE ON credit_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_mutation();
