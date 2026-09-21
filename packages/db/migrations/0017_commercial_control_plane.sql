-- Versioned commercial policy snapshots. Existing plans, wallets, ledgers, and
-- payment history remain the compatibility and accounting projections.

CREATE TABLE IF NOT EXISTS control_plane_plan_price_versions (
  id uuid PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plans(id),
  version integer NOT NULL CHECK (version > 0),
  pricing_region text NOT NULL CHECK (pricing_region IN ('INDIA', 'GLOBAL')),
  currency text NOT NULL CHECK (currency IN ('INR', 'USD')),
  monthly_amount numeric(20, 7) NOT NULL CHECK (monthly_amount >= 0),
  yearly_amount numeric(20, 7) CHECK (yearly_amount IS NULL OR yearly_amount >= 0),
  seat_amount numeric(20, 7) CHECK (seat_amount IS NULL OR seat_amount >= 0),
  included_monthly_credits numeric(20, 7) NOT NULL CHECK (included_monthly_credits >= 0),
  included_yearly_credits numeric(20, 7) CHECK (included_yearly_credits IS NULL OR included_yearly_credits >= 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, pricing_region, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS control_plane_plan_price_current_idx
  ON control_plane_plan_price_versions(plan_id, pricing_region, status, effective_from DESC);

CREATE TABLE IF NOT EXISTS control_plane_top_up_package_versions (
  id uuid PRIMARY KEY,
  package_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  display_name text NOT NULL,
  credits numeric(20, 7) NOT NULL CHECK (credits > 0),
  bonus_credits numeric(20, 7) NOT NULL CHECK (bonus_credits >= 0),
  validity_days integer NOT NULL CHECK (validity_days > 0),
  prices jsonb NOT NULL,
  active boolean NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  purchase_limit integer CHECK (purchase_limit IS NULL OR purchase_limit > 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS control_plane_promotions (
  id uuid PRIMARY KEY,
  promotion_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PERCENT', 'FIXED', 'BONUS_CREDITS')),
  percent_off numeric(5, 2) CHECK (percent_off IS NULL OR (percent_off >= 0 AND percent_off <= 100)),
  fixed_amount numeric(20, 7) CHECK (fixed_amount IS NULL OR fixed_amount >= 0),
  fixed_currency text CHECK (fixed_currency IS NULL OR fixed_currency IN ('INR', 'USD')),
  bonus_credits numeric(20, 7) NOT NULL CHECK (bonus_credits >= 0),
  plan_ids text[] NOT NULL DEFAULT '{}',
  pricing_regions text[] NOT NULL DEFAULT '{}',
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  per_user_redemption_limit integer CHECK (per_user_redemption_limit IS NULL OR per_user_redemption_limit > 0),
  valid_from timestamptz NOT NULL,
  expires_at timestamptz,
  active boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, version),
  CHECK (expires_at IS NULL OR expires_at > valid_from)
);
CREATE INDEX IF NOT EXISTS control_plane_promotions_code_idx
  ON control_plane_promotions(code, active, valid_from);

CREATE TABLE IF NOT EXISTS control_plane_model_pricing_versions (
  id uuid PRIMARY KEY,
  model_id text NOT NULL REFERENCES model_catalog(model_id),
  version integer NOT NULL CHECK (version > 0),
  pricing_region text NOT NULL CHECK (pricing_region IN ('INDIA', 'GLOBAL')),
  input_credits_per_1k numeric(20, 7) NOT NULL CHECK (input_credits_per_1k >= 0),
  output_credits_per_1k numeric(20, 7) NOT NULL CHECK (output_credits_per_1k >= 0),
  cached_input_credits_per_1k numeric(20, 7) CHECK (cached_input_credits_per_1k IS NULL OR cached_input_credits_per_1k >= 0),
  reasoning_credits_per_1k numeric(20, 7) CHECK (reasoning_credits_per_1k IS NULL OR reasoning_credits_per_1k >= 0),
  image_credits numeric(20, 7) CHECK (image_credits IS NULL OR image_credits >= 0),
  audio_credits numeric(20, 7) CHECK (audio_credits IS NULL OR audio_credits >= 0),
  minimum_charge_credits numeric(20, 7) NOT NULL CHECK (minimum_charge_credits >= 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, pricing_region, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

INSERT INTO control_plane_plan_price_versions
  (id, plan_id, version, pricing_region, currency, monthly_amount, yearly_amount,
   seat_amount, included_monthly_credits, included_yearly_credits, effective_from, status)
SELECT md5('commercial-plan-price:' || p.id || ':INDIA')::uuid,
       p.id, 1, 'INDIA', 'INR', p.monthly_price_inr, NULL, NULL, p.monthly_credits, NULL,
       now(), 'ACTIVE'
FROM plans p
WHERE NOT EXISTS (
  SELECT 1 FROM control_plane_plan_price_versions v
  WHERE v.plan_id = p.id AND v.pricing_region = 'INDIA'
);

INSERT INTO control_plane_plan_price_versions
  (id, plan_id, version, pricing_region, currency, monthly_amount, yearly_amount,
   seat_amount, included_monthly_credits, included_yearly_credits, effective_from, status)
SELECT md5('commercial-plan-price:' || p.id || ':GLOBAL')::uuid,
       p.id, 1, 'GLOBAL', 'USD', COALESCE(p.monthly_price_usd, 0), NULL, NULL, p.monthly_credits, NULL,
       now(), 'ACTIVE'
FROM plans p
WHERE NOT EXISTS (
  SELECT 1 FROM control_plane_plan_price_versions v
  WHERE v.plan_id = p.id AND v.pricing_region = 'GLOBAL'
);

INSERT INTO control_plane_top_up_package_versions
  (id, package_id, version, display_name, credits, bonus_credits, validity_days, prices,
   active, display_order, purchase_limit, effective_from)
VALUES
  (md5('commercial-topup:TOPUP_50')::uuid, 'TOPUP_50', 1, '50 credits', 50, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"100","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"0.8","taxIncluded":true}}'::jsonb, true, 50, NULL, now()),
  (md5('commercial-topup:TOPUP_100')::uuid, 'TOPUP_100', 1, '100 credits', 100, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"200","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"1.6","taxIncluded":true}}'::jsonb, true, 100, NULL, now()),
  (md5('commercial-topup:TOPUP_250')::uuid, 'TOPUP_250', 1, '250 credits', 250, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"500","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"4","taxIncluded":true}}'::jsonb, true, 250, NULL, now()),
  (md5('commercial-topup:TOPUP_500')::uuid, 'TOPUP_500', 1, '500 credits', 500, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"950","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"8","taxIncluded":true}}'::jsonb, true, 500, NULL, now()),
  (md5('commercial-topup:TOPUP_1000')::uuid, 'TOPUP_1000', 1, '1000 credits', 1000, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"1800","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"16","taxIncluded":true}}'::jsonb, true, 1000, NULL, now()),
  (md5('commercial-topup:TOPUP_2500')::uuid, 'TOPUP_2500', 1, '2500 credits', 2500, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"4250","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"38","taxIncluded":true}}'::jsonb, true, 2500, NULL, now()),
  (md5('commercial-topup:TOPUP_5000')::uuid, 'TOPUP_5000', 1, '5000 credits', 5000, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"8000","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"72","taxIncluded":true}}'::jsonb, true, 5000, NULL, now()),
  (md5('commercial-topup:TOPUP_10000')::uuid, 'TOPUP_10000', 1, '10000 credits', 10000, 0, 365,
   '{"INDIA":{"currency":"INR","amount":"15000","taxIncluded":true},"GLOBAL":{"currency":"USD","amount":"135","taxIncluded":true}}'::jsonb, true, 10000, NULL, now())
ON CONFLICT (package_id, version) DO NOTHING;
