import { describe, expect, it } from 'vitest';
import { parseUsageReceipt } from '@lyntar/model-gateway';

describe('usage receipts', () => {
  it('parses provider-supplied usage and preserves request correlation', () => {
    const receipt = parseUsageReceipt(
      {
        usage: { prompt_tokens: 12, completion_tokens: 7, cache_read_input_tokens: 4 },
        cost: { total: 0.0031 },
        model: 'provider/model',
      },
      { requestId: 'req-1', taskId: 'task-1', modelId: 'catalog-model', providerRoute: 'gateway' },
    );
    expect(receipt).toMatchObject({
      requestId: 'req-1',
      taskId: 'task-1',
      inputTokens: 12,
      outputTokens: 7,
      cacheTokens: 4,
      actualCostUsd: 0.0031,
    });
  });

  it('does not fabricate a receipt when provider usage is absent', () => {
    expect(
      parseUsageReceipt(
        { usage: {} },
        { requestId: 'req-2', taskId: 'task-2', modelId: 'm', providerRoute: 'gateway' },
      ),
    ).toBeNull();
  });
});
