-- Astra Code Room project binding, Room Files, controlled imports, and
-- deterministic security events. The existing rooms row remains the canonical
-- one-primary-project binding; these columns make that binding explicit.

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS primary_project_id uuid;
UPDATE rooms SET primary_project_id = id WHERE primary_project_id IS NULL;
ALTER TABLE rooms ALTER COLUMN primary_project_id SET NOT NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS workspace_fingerprint text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS host_availability text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS host_binding_version integer NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_host_availability_check') THEN
    ALTER TABLE rooms ADD CONSTRAINT rooms_host_availability_check
      CHECK (host_availability IN ('ONLINE', 'OFFLINE', 'UNAVAILABLE', 'REVOKED', 'DISCONNECTED', 'UNKNOWN'));
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS rooms_primary_project_uq ON rooms(primary_project_id);

CREATE TABLE IF NOT EXISTS room_files (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploader_user_id uuid NOT NULL REFERENCES users(id),
  original_name text NOT NULL,
  safe_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('REFERENCE', 'ADD_TO_PROJECT')),
  security_state text NOT NULL CHECK (security_state IN ('UPLOADED', 'VALIDATING', 'SAFE', 'REJECTED', 'DELETED')),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS room_files_room_idx ON room_files(room_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS room_files_checksum_uq
  ON room_files(room_id, checksum_sha256)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS room_file_imports (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES room_files(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  destination_relative text NOT NULL,
  status text NOT NULL CHECK (status IN ('PREVIEW', 'APPROVED', 'REJECTED', 'IMPORTED', 'FAILED')),
  manifest jsonb NOT NULL,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_file_imports_room_idx ON room_file_imports(room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS room_security_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id uuid REFERENCES remote_devices(id) ON DELETE SET NULL,
  project_id uuid,
  task_id text,
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  requested_action text NOT NULL,
  requested_resource text,
  decision text NOT NULL CHECK (decision IN ('BLOCKED', 'ALLOWED', 'FLAGGED')),
  outcome text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_security_events_room_idx
  ON room_security_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS room_security_events_org_idx
  ON room_security_events(organization_id, severity, created_at DESC);
