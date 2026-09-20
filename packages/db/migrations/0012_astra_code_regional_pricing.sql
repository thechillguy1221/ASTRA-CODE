-- Astra Code V1 regional subscription and credit-pack catalog.
-- Country is stored only at country granularity; checkout must re-verify it.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS monthly_price_usd numeric(20, 2);

UPDATE plans
SET monthly_price_usd = CASE id
  WHEN 'FREE' THEN 0
  WHEN 'BASIC' THEN 6
  WHEN 'PRO' THEN 11
  WHEN 'MAX' THEN 21
  WHEN 'TEAM' THEN 105
  WHEN 'BUSINESS' THEN 209
  ELSE COALESCE(monthly_price_usd, 0)
END,
monthly_price_inr = CASE id
  WHEN 'FREE' THEN 0
  WHEN 'BASIC' THEN 549
  WHEN 'PRO' THEN 999
  WHEN 'MAX' THEN 1899
  WHEN 'TEAM' THEN 9499
  WHEN 'BUSINESS' THEN 18999
  ELSE monthly_price_inr
END;

ALTER TABLE plans ALTER COLUMN monthly_price_usd SET NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_country char(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_region text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_country_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_country_source text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_country char(2);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pricing_region text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_country_verified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_pricing_region_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_pricing_region_chk
      CHECK (pricing_region IS NULL OR pricing_region IN ('INDIA', 'GLOBAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_pricing_region_chk') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_pricing_region_chk
      CHECK (pricing_region IS NULL OR pricing_region IN ('INDIA', 'GLOBAL'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS credit_pack_catalog (
  id text PRIMARY KEY,
  credits numeric(20, 7) NOT NULL CHECK (credits > 0),
  validity_days integer NOT NULL CHECK (validity_days > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_pack_prices (
  pack_id text NOT NULL REFERENCES credit_pack_catalog(id) ON DELETE CASCADE,
  pricing_region text NOT NULL CHECK (pricing_region IN ('INDIA', 'GLOBAL')),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD')),
  amount numeric(20, 6) NOT NULL CHECK (amount >= 0),
  tax_included boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pack_id, pricing_region)
);

INSERT INTO credit_pack_catalog (id, credits, validity_days)
VALUES
  ('TOPUP_50', 50, 365),
  ('TOPUP_100', 100, 365),
  ('TOPUP_250', 250, 365),
  ('TOPUP_500', 500, 365),
  ('TOPUP_1000', 1000, 365),
  ('TOPUP_2500', 2500, 365),
  ('TOPUP_5000', 5000, 365),
  ('TOPUP_10000', 10000, 365)
ON CONFLICT (id) DO UPDATE SET credits = EXCLUDED.credits, validity_days = EXCLUDED.validity_days,
  updated_at = now();

INSERT INTO credit_pack_prices (pack_id, pricing_region, currency, amount)
VALUES
  ('TOPUP_50', 'INDIA', 'INR', 100),
  ('TOPUP_50', 'GLOBAL', 'USD', 0.8),
  ('TOPUP_100', 'INDIA', 'INR', 200),
  ('TOPUP_100', 'GLOBAL', 'USD', 1.6),
  ('TOPUP_250', 'INDIA', 'INR', 500),
  ('TOPUP_250', 'GLOBAL', 'USD', 4),
  ('TOPUP_500', 'INDIA', 'INR', 950),
  ('TOPUP_500', 'GLOBAL', 'USD', 8),
  ('TOPUP_1000', 'INDIA', 'INR', 1800),
  ('TOPUP_1000', 'GLOBAL', 'USD', 16),
  ('TOPUP_2500', 'INDIA', 'INR', 4250),
  ('TOPUP_2500', 'GLOBAL', 'USD', 38),
  ('TOPUP_5000', 'INDIA', 'INR', 8000),
  ('TOPUP_5000', 'GLOBAL', 'USD', 72),
  ('TOPUP_10000', 'INDIA', 'INR', 15000),
  ('TOPUP_10000', 'GLOBAL', 'USD', 135)
ON CONFLICT (pack_id, pricing_region) DO UPDATE SET currency = EXCLUDED.currency,
  amount = EXCLUDED.amount, tax_included = EXCLUDED.tax_included, updated_at = now();

CREATE TABLE IF NOT EXISTS wallet_auto_topup_policies (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  enabled boolean NOT NULL DEFAULT false,
  threshold_credits numeric(20, 7) NOT NULL CHECK (threshold_credits >= 0),
  pack_id text NOT NULL REFERENCES credit_pack_catalog(id),
  period_limit_amount numeric(20, 6) NOT NULL CHECK (period_limit_amount >= 0),
  period_limit_currency text NOT NULL CHECK (period_limit_currency IN ('INR', 'USD')),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (organization_id IS NULL)),
  UNIQUE (user_id),
  UNIQUE (organization_id)
);
