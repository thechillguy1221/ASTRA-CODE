import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryUsageReceiptStore } from '@astra/db';
import { VercelGatewayClient } from '@astra/model-gateway';
import { resolveLiveConfiguration } from '../../scripts/certification.mjs';

const liveConfiguration = resolveLiveConfiguration(process.env);

if (liveConfiguration.status === 'BLOCKED') {
  console.warn(
    `[BLOCKED] Live model smoke is disabled or missing configuration: ${liveConfiguration.missing.join(', ')}`,
  );
}

describe('live model gateway smoke', () => {
  if (liveConfiguration.status === 'BLOCKED') {
    it.skip(`[BLOCKED] configure ${liveConfiguration.missing.join(', ')}`, () => undefined);
    return;
  }

  it('records a real structured decision and provider usage receipt', async () => {
    const requestId = randomUUID();
    const taskId = `live-smoke-${randomUUID()}`;
    const { baseUrl, apiKey, modelId } = liveConfiguration.credentials;
    const gateway = new VercelGatewayClient({ baseUrl, apiKey });
    const receipts = new InMemoryUsageReceiptStore();
    let decisionSeen = false;
    let providerRequestId: string | undefined;
    let usage;

    try {
      for await (const event of gateway.complete(
        {
          requestId,
          taskId,
          modelId,
          gatewayModelId: modelId,
          messages: [
            {
              role: 'user',
              content:
                'Return one JSON message action with the summary "Live Gateway smoke passed".',
            },
          ],
        },
        new AbortController().signal,
      )) {
        if (event.type === 'decision') decisionSeen = true;
        if (event.type === 'provider') providerRequestId = event.providerRequestId;
        if (event.type === 'usage') usage = event.receipt;
      }
    } catch {
      throw new Error('[UNVERIFIED] Live Gateway request failed');
    }

    if (!decisionSeen) throw new Error('[UNVERIFIED] Live Gateway returned no structured decision');
    if (!usage) throw new Error('[UNVERIFIED] Provider returned no trustworthy usage metadata');
    await receipts.save(usage);
    const persisted = await receipts.listForTask(taskId);
    expect(persisted).toHaveLength(1);
    console.log(
      `[PASS] Live model smoke model=${modelId} request_id=${requestId} provider_request_id=${providerRequestId ?? 'unreported'} actual_cost_usd=${usage.actualCostUsd ?? 'unreported'}`,
    );
  });
});
