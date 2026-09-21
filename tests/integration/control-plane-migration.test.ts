import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('control-plane foundation migration', () => {
  it('defines versioned policy storage, permission mappings, and append-only audit guards', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'packages/db/migrations/0016_control_plane_foundation.sql'),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS control_plane_plan_versions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS control_plane_model_history');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS control_plane_role_permissions');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation');
    expect(migration).toContain('CREATE TRIGGER admin_audit_log_no_update');
    expect(migration).toContain('ON CONFLICT DO NOTHING');
  });

  it('registers the migration in the production migration runner', async () => {
    const source = await readFile(resolve(process.cwd(), 'packages/db/src/postgres.ts'), 'utf8');
    expect(source).toContain("version: '0016_control_plane_foundation'");
    expect(source).toContain("file: '0016_control_plane_foundation.sql'");
    expect(source).toContain("version: '0017_commercial_control_plane'");
    expect(source).toContain("file: '0017_commercial_control_plane.sql'");
  });

  it('defines versioned commercial pricing, top-up, promotion, and model pricing storage', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'packages/db/migrations/0017_commercial_control_plane.sql'),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS control_plane_plan_price_versions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS control_plane_top_up_package_versions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS control_plane_promotions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS control_plane_model_pricing_versions');
    expect(migration).toContain('ON CONFLICT (package_id, version) DO NOTHING');
  });
});
