import { describe, expect, it } from 'vitest';
import { runCertification } from '../../scripts/certification.mjs';

describe('certification report', () => {
  it('reports unavailable live credentials as BLOCKED rather than PASS', async () => {
    const report = await runCertification({ liveCredentials: undefined });

    expect(report.liveModel.status).toBe('BLOCKED');
    expect(report.verdict).not.toBe('CERTIFIED');
  });
});
