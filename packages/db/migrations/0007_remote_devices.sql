-- Astra Remote device pairing and session tracking

CREATE TABLE IF NOT EXISTS remote_devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  label text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  public_key_pem text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS remote_devices_user_idx ON remote_devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS remote_devices_fingerprint_user_uq ON remote_devices(user_id, fingerprint);

CREATE TABLE IF NOT EXISTS remote_pairing_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  pairing_token_hash text NOT NULL UNIQUE,
  relay_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  device_id uuid REFERENCES remote_devices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS remote_pairing_user_idx ON remote_pairing_sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS remote_relay_sessions (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES remote_devices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  agent_session_id uuid REFERENCES agent_sessions(id),
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz
);
CREATE INDEX IF NOT EXISTS remote_relay_sessions_device_idx ON remote_relay_sessions(device_id);
