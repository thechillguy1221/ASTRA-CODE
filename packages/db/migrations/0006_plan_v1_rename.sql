-- Astra V1 plan catalog alignment: rename STUDENT→BUILDER, update pricing and credits.
-- Safe to re-run: all changes use IF EXISTS / ON CONFLICT.

-- Insert new plans with V1 pricing (on conflict update)
INSERT INTO plans (id, display_name, monthly_price_inr, monthly_credits, entitlements, enabled)
VALUES
  ('FREE', 'Free', 0, 20,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"20","maxConcurrentJobs":1,"mcpLimit":0,"pluginLimit":0,"premiumModeAccess":false,"maxContextWindow":128000,"priority":"standard"}'::jsonb,
   true),
  ('BUILDER', 'Builder', 399, 250,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"250","maxConcurrentJobs":3,"mcpLimit":10,"pluginLimit":10,"premiumModeAccess":true,"maxContextWindow":200000,"priority":"priority"}'::jsonb,
   true),
  ('PRO', 'Pro', 799, 500,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"500","maxConcurrentJobs":5,"mcpLimit":20,"pluginLimit":20,"premiumModeAccess":true,"maxContextWindow":256000,"priority":"priority"}'::jsonb,
   true),
  ('MAX', 'Max', 1599, 1000,
   '{"allowedModelIds":["*"],"allowedModes":["BUILD","LEARN","VIVA","HACKATHON"],"maxTaskBudgetCredits":"1000","maxConcurrentJobs":10,"mcpLimit":100,"pluginLimit":100,"premiumModeAccess":true,"maxContextWindow":1000000,"priority":"highest"}'::jsonb,
   true)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  monthly_price_inr = EXCLUDED.monthly_price_inr,
  monthly_credits = EXCLUDED.monthly_credits,
  entitlements = EXCLUDED.entitlements,
  enabled = EXCLUDED.enabled,
  updated_at = now();

-- Migrate STUDENT → BUILDER (rename plan)
INSERT INTO plans (id, display_name, monthly_price_inr, monthly_credits, entitlements, enabled)
SELECT 'BUILDER', 'Builder', 399, 250, entitlements, true
FROM plans WHERE id = 'STUDENT'
ON CONFLICT (id) DO NOTHING;

-- Move users from STUDENT plan to BUILDER
UPDATE users SET plan_id = 'BUILDER' WHERE plan_id = 'STUDENT';

-- Move subscriptions from STUDENT plan to BUILDER  
UPDATE subscriptions SET plan_id = 'BUILDER' WHERE plan_id = 'STUDENT';

-- Remove STUDENT plan (if no references remain)
DELETE FROM plans WHERE id = 'STUDENT'
  AND NOT EXISTS (SELECT 1 FROM users WHERE plan_id = 'STUDENT')
  AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_id = 'STUDENT');

-- Add subscription state fields if not already present
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS halted_at timestamptz;

-- Update FREE plan credits to exactly 20
UPDATE plans SET monthly_credits = 20, updated_at = now() WHERE id = 'FREE';
