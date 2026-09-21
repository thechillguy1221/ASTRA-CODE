import { describe, expect, it } from 'vitest';
import { runCertification } from '../../scripts/certification.mjs';
import { resolveLiveConfiguration } from '../../scripts/certification.mjs';

describe('certification report', () => {
  it('reports unavailable live credentials as BLOCKED rather than PASS', async () => {
    const report = await runCertification({ liveCredentials: undefined });

    expect(report.liveModel.status).toBe('BLOCKED');
    expect(report.verdict).not.toBe('CERTIFIED');
  });

  it('requires an explicit test-only model for live certification', () => {
    const result = resolveLiveConfiguration({
      ASTRA_LIVE_TEST: '1',
      ASTRA_MODEL_GATEWAY_URL: 'https://gateway.example.test',
      ASTRA_MODEL_GATEWAY_API_KEY: 'gateway-secret',
      ASTRA_MODEL_ID: 'legacy-global-model',
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.missing).toContain('ASTRA_LIVE_TEST_MODEL_ID');
  });
});
