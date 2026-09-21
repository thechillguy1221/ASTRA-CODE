CREATE TABLE IF NOT EXISTS email_sender_identities (
  kind text PRIMARY KEY CHECK (kind IN ('DEFAULT', 'NOREPLY', 'SUPPORT', 'BILLING', 'SECURITY')),
  from_address text NOT NULL CHECK (position(E'\n' IN from_address) = 0 AND position(E'\r' IN from_address) = 0),
  reply_to text CHECK (reply_to IS NULL OR (position(E'\n' IN reply_to) = 0 AND position(E'\r' IN reply_to) = 0)),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
