import { describe, expect, it } from 'vitest';
import { assertProductionConfiguration, loadConfig } from '@lyntar/config';

describe('production configuration guard', () => {
  it('rejects an in-memory/incomplete production server configuration', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    expect(() => assertProductionConfiguration(config, { NODE_ENV: 'production' })).toThrow(
      /LYNTAR_DATABASE_URL/,
    );
  });

  it('does not block deterministic development configuration', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(() => assertProductionConfiguration(config, { NODE_ENV: 'development' })).not.toThrow();
  });
});
