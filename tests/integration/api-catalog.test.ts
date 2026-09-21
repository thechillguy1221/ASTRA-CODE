import { describe, expect, it } from 'vitest';
import { buildApi, createMemoryCatalog } from '@astra/api';

describe('model catalog API', () => {
  it('serves an enabled server catalog without desktop model constants', async () => {
    const app = buildApi({
      catalog: createMemoryCatalog([
        {
          modelId: 'balanced',
          displayName: 'Configured model',
          gatewayModelId: 'provider/model',
          providerSlug: 'provider',
          enabled: true,
          capabilities: {
            supportsTools: true,
            supportsStreaming: true,
            supportsReasoning: false,
            supportsStructuredOutput: true,
            supportsImageInput: false,
          },
        },
      ]),
    });
    const response = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);
    expect(response.json().models[0].gatewayModelId).toBe('provider/model');
  });

  it('does not expose enabled but hidden catalog entries to the desktop', async () => {
    const app = buildApi({
      catalog: createMemoryCatalog([
        {
          modelId: 'internal',
          displayName: 'Internal model',
          gatewayModelId: 'provider/internal',
          providerSlug: 'provider',
          enabled: true,
          visible: false,
          capabilities: {
            supportsTools: true,
            supportsStreaming: true,
            supportsReasoning: false,
            supportsStructuredOutput: true,
            supportsImageInput: false,
          },
        },
      ]),
    });

    const response = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);
    expect(response.json().models).toEqual([]);
  });
});
