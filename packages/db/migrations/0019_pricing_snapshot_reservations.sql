-- Capture the commercial pricing snapshot at reservation time. Settlement
-- reads this immutable copy so later tariff edits cannot reprice running work.
ALTER TABLE credit_reservations
  ADD COLUMN IF NOT EXISTS pricing_version integer,
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;
ALTER TABLE organization_credit_reservations
  ADD COLUMN IF NOT EXISTS pricing_version integer,
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;
