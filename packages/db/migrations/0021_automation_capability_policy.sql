ALTER TABLE control_plane_maintenance_policies
  DROP CONSTRAINT IF EXISTS control_plane_maintenance_policies_policy_key_check;
ALTER TABLE control_plane_maintenance_policies
  ADD CONSTRAINT control_plane_maintenance_policies_policy_key_check
  CHECK (policy_key IN ('ASTRA_CODE','GLOBAL','MODELS','PAYMENTS','WEB_SEARCH','WEB_FETCH','MCP','PLUGINS','SKILLS','REMOTE_ACCESS','AUTOMATIONS','ROOMS','EMAIL'));

ALTER TABLE control_plane_capability_policies
  DROP CONSTRAINT IF EXISTS control_plane_capability_policies_policy_key_check;
ALTER TABLE control_plane_capability_policies
  ADD CONSTRAINT control_plane_capability_policies_policy_key_check
  CHECK (policy_key IN ('ASTRA_CODE','WEB_SEARCH','WEB_FETCH','MCP','PLUGINS','SKILLS','REMOTE_ACCESS','AUTOMATIONS'));

INSERT INTO control_plane_maintenance_policies
  (policy_key, version, enabled, message, effective_from, affected_plan_ids, emergency_override, updated_by)
VALUES ('ASTRA_CODE', 1, false, 'No maintenance scheduled', now(), '{}', false, 'system')
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO control_plane_capability_policies
  (policy_key, version, enabled, allowed_transports, updated_by)
VALUES ('ASTRA_CODE', 1, true, ARRAY['stdio','sse','streamable-http'], 'system')
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO control_plane_maintenance_policies
  (policy_key, version, enabled, message, effective_from, affected_plan_ids, emergency_override, updated_by)
VALUES ('AUTOMATIONS', 1, false, 'No maintenance scheduled', now(), '{}', false, 'system')
ON CONFLICT (policy_key) DO NOTHING;

INSERT INTO control_plane_capability_policies
  (policy_key, version, enabled, allowed_transports, updated_by)
VALUES ('AUTOMATIONS', 1, true, ARRAY['stdio','sse','streamable-http'], 'system')
ON CONFLICT (policy_key) DO NOTHING;
