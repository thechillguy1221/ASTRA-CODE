CREATE TABLE IF NOT EXISTS astra_platform_records (
  kind text NOT NULL,
  record_id text NOT NULL,
  owner_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (kind, record_id)
);

CREATE INDEX IF NOT EXISTS astra_platform_records_owner_idx
  ON astra_platform_records (owner_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS astra_platform_events (
  event_id text PRIMARY KEY,
  kind text NOT NULL,
  entity_id text NOT NULL,
  actor_id text,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS astra_platform_events_entity_idx
  ON astra_platform_events (entity_id, created_at ASC, event_id ASC);

CREATE OR REPLACE FUNCTION astra_platform_append_only_events() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'astra_platform_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS astra_platform_events_no_update ON astra_platform_events;
CREATE TRIGGER astra_platform_events_no_update
  BEFORE UPDATE OR DELETE ON astra_platform_events
  FOR EACH ROW EXECUTE FUNCTION astra_platform_append_only_events();
