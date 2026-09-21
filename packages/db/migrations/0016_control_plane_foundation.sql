-- Versioned Astra control-plane foundation.
-- Existing plans, subscriptions, wallets, and model rows remain authoritative
-- compatibility projections until the control-plane services are wired.

ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS provider_icon text;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS maintenance_status text NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS maintenance_message text;
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS region_availability text[] NOT NULL DEFAULT ARRAY['GLOBAL']::text[];
ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS control_plane_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS control_plane_plan_definitions (
  plan_id text PRIMARY KEY REFERENCES plans(id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED')),
  is_public boolean NOT NULL DEFAULT true,
  purchase_available boolean NOT NULL DEFAULT false,
  current_version integer NOT NULL CHECK (current_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_plane_plan_versions (
  id uuid PRIMARY KEY,
  plan_id text NOT NULL REFERENCES control_plane_plan_definitions(plan_id),
  version integer NOT NULL CHECK (version > 0),
  display_name text NOT NULL,
  monthly_price_inr numeric(20, 2) NOT NULL CHECK (monthly_price_inr >= 0),
  monthly_price_usd numeric(20, 2) NOT NULL CHECK (monthly_price_usd >= 0),
  monthly_credits numeric(20, 7) NOT NULL CHECK (monthly_credits >= 0),
  allowed_model_ids text[] NOT NULL,
  allowed_modes text[] NOT NULL,
  max_task_budget_credits numeric(20, 7) NOT NULL CHECK (max_task_budget_credits >= 0),
  max_concurrent_jobs integer NOT NULL CHECK (max_concurrent_jobs > 0),
  mcp_limit integer NOT NULL CHECK (mcp_limit >= 0),
  plugin_limit integer NOT NULL CHECK (plugin_limit >= 0),
  premium_mode_access boolean NOT NULL,
  max_context_window integer NOT NULL CHECK (max_context_window > 0),
  priority text NOT NULL CHECK (priority IN ('standard', 'priority', 'highest')),
  enabled boolean NOT NULL,
  seats integer NOT NULL CHECK (seats > 0),
  active_jobs_per_seat integer NOT NULL CHECK (active_jobs_per_seat > 0),
  pooled_credits boolean NOT NULL,
  cross_person_rooms boolean NOT NULL,
  rollover_cycles integer NOT NULL CHECK (rollover_cycles >= 0),
  top_up_enabled boolean NOT NULL,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS control_plane_plan_versions_current_idx
  ON control_plane_plan_versions(plan_id, version DESC);

CREATE TABLE IF NOT EXISTS control_plane_plan_entitlements (
  plan_id text NOT NULL,
  version integer NOT NULL,
  entitlement_key text NOT NULL,
  enabled boolean NOT NULL,
  PRIMARY KEY (plan_id, version, entitlement_key),
  FOREIGN KEY (plan_id, version)
    REFERENCES control_plane_plan_versions(plan_id, version)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_plane_plan_limits (
  plan_id text NOT NULL,
  version integer NOT NULL,
  limit_key text NOT NULL,
  limit_kind text NOT NULL CHECK (limit_kind IN ('DISABLED', 'UNLIMITED', 'NUMERIC')),
  numeric_value integer CHECK (numeric_value IS NULL OR numeric_value >= 0),
  PRIMARY KEY (plan_id, version, limit_key),
  FOREIGN KEY (plan_id, version)
    REFERENCES control_plane_plan_versions(plan_id, version)
    ON DELETE CASCADE,
  CHECK ((limit_kind = 'NUMERIC' AND numeric_value IS NOT NULL) OR
         (limit_kind <> 'NUMERIC' AND numeric_value IS NULL))
);

CREATE TABLE IF NOT EXISTS control_plane_plan_model_access (
  plan_id text NOT NULL,
  version integer NOT NULL,
  model_id text NOT NULL REFERENCES model_catalog(model_id),
  enabled boolean NOT NULL,
  PRIMARY KEY (plan_id, version, model_id),
  FOREIGN KEY (plan_id, version)
    REFERENCES control_plane_plan_versions(plan_id, version)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_plane_model_history (
  model_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  changed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, version),
  FOREIGN KEY (model_id) REFERENCES model_catalog(model_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_plane_role_permissions (
  role text NOT NULL,
  permission text NOT NULL,
  PRIMARY KEY (role, permission)
);

INSERT INTO control_plane_role_permissions(role, permission)
VALUES
  ('SUPER_ADMIN', 'admin.users'),
  ('SUPER_ADMIN', 'admin.organizations'),
  ('SUPER_ADMIN', 'admin.rooms'),
  ('SUPER_ADMIN', 'admin.billing'),
  ('SUPER_ADMIN', 'admin.models'),
  ('SUPER_ADMIN', 'admin.plans'),
  ('SUPER_ADMIN', 'admin.security'),
  ('SUPER_ADMIN', 'admin.email'),
  ('SUPER_ADMIN', 'admin.features'),
  ('SUPER_ADMIN', 'admin.releases'),
  ('SUPER_ADMIN', 'admin.system'),
  ('ADMIN', 'admin.users'),
  ('ADMIN', 'admin.security'),
  ('ADMIN', 'admin.email'),
  ('ADMIN', 'admin.system'),
  ('FINANCE', 'admin.billing'),
  ('FINANCE', 'admin.plans'),
  ('SUPPORT', 'admin.users'),
  ('SUPPORT', 'admin.rooms')
ON CONFLICT DO NOTHING;

ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS ip_address inet;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS redacted boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin audit log is append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'admin_audit_log_no_update') THEN
    CREATE TRIGGER admin_audit_log_no_update
      BEFORE UPDATE ON admin_audit_log
      FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'admin_audit_log_no_delete') THEN
    CREATE TRIGGER admin_audit_log_no_delete
      BEFORE DELETE ON admin_audit_log
      FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();
  END IF;
END;
$$;

-- Import current Astra behavior only when the new projection is empty. This
-- preserves existing subscriber terms and never overwrites a control-plane
-- version that an administrator has already created.
INSERT INTO control_plane_plan_definitions(
  plan_id, status, is_public, purchase_available, current_version
)
SELECT p.id,
       CASE WHEN p.enabled THEN 'ACTIVE' ELSE 'INACTIVE' END,
       true,
       p.id <> 'FREE',
       1
FROM plans p
ON CONFLICT (plan_id) DO NOTHING;

INSERT INTO control_plane_plan_versions(
  id, plan_id, version, display_name, monthly_price_inr, monthly_price_usd,
  monthly_credits, allowed_model_ids, allowed_modes, max_task_budget_credits,
  max_concurrent_jobs, mcp_limit, plugin_limit, premium_mode_access,
  max_context_window, priority, enabled, seats, active_jobs_per_seat,
  pooled_credits, cross_person_rooms, rollover_cycles, top_up_enabled,
  entitlements, limits, effective_from
)
SELECT md5('control-plane-plan-version:' || p.id)::uuid,
       p.id,
       1,
       p.display_name,
       p.monthly_price_inr,
       COALESCE(p.monthly_price_usd, 0),
       p.monthly_credits,
       COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(p.entitlements->'allowedModelIds')), ARRAY['*']::text[]),
       COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(p.entitlements->'allowedModes')), ARRAY['BUILD']::text[]),
       COALESCE((p.entitlements->>'maxTaskBudgetCredits')::numeric, p.monthly_credits),
       COALESCE((p.entitlements->>'maxConcurrentJobs')::integer, 1),
       COALESCE((p.entitlements->>'mcpLimit')::integer, 0),
       COALESCE((p.entitlements->>'pluginLimit')::integer, 0),
       COALESCE((p.entitlements->>'premiumModeAccess')::boolean, false),
       COALESCE((p.entitlements->>'maxContextWindow')::integer, 128000),
       COALESCE(p.entitlements->>'priority', 'standard'),
       p.enabled,
       COALESCE((p.entitlements->>'seats')::integer, 1),
       COALESCE((p.entitlements->>'activeJobsPerSeat')::integer, 1),
       COALESCE((p.entitlements->>'pooledCredits')::boolean, false),
       COALESCE((p.entitlements->>'crossPersonRooms')::boolean, false),
       COALESCE((p.entitlements->>'rolloverCycles')::integer, 1),
       COALESCE((p.entitlements->>'topUpEnabled')::boolean, false),
       jsonb_build_object(
         'webSearch', COALESCE((p.entitlements->>'premiumModeAccess')::boolean, false),
         'mcp', COALESCE((p.entitlements->>'mcpLimit')::integer, 0) > 0,
         'plugins', COALESCE((p.entitlements->>'pluginLimit')::integer, 0) > 0
       ),
       jsonb_build_object(
         'mcp', jsonb_build_object('kind', 'NUMERIC', 'value', COALESCE((p.entitlements->>'mcpLimit')::integer, 0)),
         'plugins', jsonb_build_object('kind', 'NUMERIC', 'value', COALESCE((p.entitlements->>'pluginLimit')::integer, 0))
       ),
       now()
FROM plans p
WHERE NOT EXISTS (
  SELECT 1 FROM control_plane_plan_versions v WHERE v.plan_id = p.id AND v.version = 1
);

INSERT INTO control_plane_plan_entitlements(plan_id, version, entitlement_key, enabled)
SELECT v.plan_id, v.version, entry.key, entry.value::boolean
FROM control_plane_plan_versions v
JOIN LATERAL jsonb_each_text(v.entitlements) entry ON true
ON CONFLICT DO NOTHING;

INSERT INTO control_plane_plan_limits(plan_id, version, limit_key, limit_kind, numeric_value)
SELECT v.plan_id, v.version, entry.key,
       entry.value->>'kind',
       CASE WHEN entry.value->>'kind' = 'NUMERIC' THEN (entry.value->>'value')::integer ELSE NULL END
FROM control_plane_plan_versions v
JOIN LATERAL jsonb_each(v.limits) entry ON true
ON CONFLICT DO NOTHING;

INSERT INTO control_plane_plan_model_access(plan_id, version, model_id, enabled)
SELECT v.plan_id, v.version, model_id, true
FROM control_plane_plan_versions v
JOIN LATERAL unnest(v.allowed_model_ids) model_id ON true
WHERE model_id <> '*'
  AND EXISTS (SELECT 1 FROM model_catalog m WHERE m.model_id = model_id)
ON CONFLICT DO NOTHING;

INSERT INTO control_plane_model_history(model_id, version, snapshot)
SELECT m.model_id, 1, to_jsonb(m)
FROM model_catalog m
ON CONFLICT DO NOTHING;
