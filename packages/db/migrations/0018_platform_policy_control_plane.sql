-- Versioned platform policy snapshots. Writes are append-only for feature
-- flags and optimistic-versioned for the current policy projections.

CREATE TABLE IF NOT EXISTS control_plane_feature_flag_versions (
  flag_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  flag_key text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL,
  scope text NOT NULL CHECK (scope IN ('GLOBAL','PLAN','USER','ORGANIZATION','ROOM','REGION','BETA_GROUP','INTERNAL')),
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollout_percentage integer NOT NULL CHECK (rollout_percentage BETWEEN 0 AND 100),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','RETIRED')),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS control_plane_feature_flag_current_idx
  ON control_plane_feature_flag_versions(flag_id, version DESC);

CREATE TABLE IF NOT EXISTS control_plane_maintenance_policies (
  policy_key text PRIMARY KEY CHECK (policy_key IN ('GLOBAL','MODELS','PAYMENTS','WEB_SEARCH','WEB_FETCH','MCP','PLUGINS','SKILLS','REMOTE_ACCESS','ROOMS','EMAIL')),
  version integer NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL,
  message text NOT NULL,
  effective_from timestamptz NOT NULL,
  expected_end timestamptz,
  affected_plan_ids text[] NOT NULL DEFAULT '{}',
  emergency_override boolean NOT NULL DEFAULT false,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_end IS NULL OR expected_end > effective_from)
);

CREATE TABLE IF NOT EXISTS control_plane_capability_policies (
  policy_key text PRIMARY KEY CHECK (policy_key IN ('WEB_SEARCH','WEB_FETCH','MCP','PLUGINS','SKILLS','REMOTE_ACCESS')),
  version integer NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL,
  allowed_plan_ids text[] NOT NULL DEFAULT '{}',
  blocked_plan_ids text[] NOT NULL DEFAULT '{}',
  allowed_organization_ids text[] NOT NULL DEFAULT '{}',
  blocked_organization_ids text[] NOT NULL DEFAULT '{}',
  allowed_servers text[] NOT NULL DEFAULT '{}',
  blocked_servers text[] NOT NULL DEFAULT '{}',
  allowed_transports text[] NOT NULL DEFAULT '{}',
  require_approval boolean NOT NULL DEFAULT false,
  max_devices integer,
  max_concurrent_sessions integer,
  session_timeout_seconds integer,
  period_limit integer,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_plane_release_policies (
  channel text PRIMARY KEY CHECK (channel IN ('stable','beta','nightly')),
  version integer NOT NULL CHECK (version > 0),
  stable_version text NOT NULL,
  beta_version text NOT NULL,
  minimum_supported_version text NOT NULL,
  recommended_version text NOT NULL,
  required_update_version text,
  blocked_versions text[] NOT NULL DEFAULT '{}',
  release_notes_url text,
  download_url text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_plane_razorpay_mappings (
  mapping_id text PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  entity_type text NOT NULL CHECK (entity_type IN ('PLAN','TOP_UP')),
  entity_id text NOT NULL,
  pricing_version integer,
  pricing_region text NOT NULL CHECK (pricing_region IN ('INDIA','GLOBAL')),
  currency text NOT NULL CHECK (currency IN ('INR','USD')),
  provider_product_id text NOT NULL,
  payment_interval text NOT NULL CHECK (payment_interval IN ('monthly','yearly','one_time')),
  active boolean NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO control_plane_maintenance_policies
  (policy_key, version, enabled, message, effective_from, affected_plan_ids, emergency_override, updated_by)
SELECT key, 1, false, 'No maintenance scheduled', now(), '{}', false, 'system'
FROM unnest(ARRAY['GLOBAL','MODELS','PAYMENTS','WEB_SEARCH','WEB_FETCH','MCP','PLUGINS','SKILLS','REMOTE_ACCESS','ROOMS','EMAIL']) AS key
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO control_plane_capability_policies
  (policy_key, version, enabled, allowed_transports, updated_by)
SELECT key, 1, true, ARRAY['stdio','sse','streamable-http'], 'system'
FROM unnest(ARRAY['WEB_SEARCH','WEB_FETCH','MCP','PLUGINS','SKILLS','REMOTE_ACCESS']) AS key
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO control_plane_release_policies
  (channel, version, stable_version, beta_version, minimum_supported_version, recommended_version, updated_by)
VALUES
  ('stable', 1, '0.1.0', '0.1.0', '0.1.0', '0.1.0', 'system'),
  ('beta', 1, '0.1.0', '0.1.0', '0.1.0', '0.1.0', 'system'),
  ('nightly', 1, '0.1.0', '0.1.0', '0.1.0', '0.1.0', 'system')
ON CONFLICT (channel) DO NOTHING;
