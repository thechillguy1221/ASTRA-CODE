-- Durable single-use desktop OAuth state. Provider secrets and access tokens are never stored.
CREATE TABLE IF NOT EXISTS oauth_transactions (
  state text PRIMARY KEY,
  provider text NOT NULL,
  code_challenge text NOT NULL,
  redirect_uri text NOT NULL,
  desktop_callback_uri text,
  device jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS oauth_desktop_codes (
  code_hash text PRIMARY KEY,
  code_challenge text NOT NULL,
  profile jsonb NOT NULL,
  device jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
