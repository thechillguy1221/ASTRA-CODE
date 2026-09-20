import { describe, expect, it } from 'vitest';
import {
  HttpWebSearchProvider,
  WebResearchService,
  type WebResearchContext,
} from '@lyntar/web-research';

const endpoint = process.env.ASTRA_WEB_SEARCH_ENDPOINT;
const apiKey = process.env.ASTRA_WEB_SEARCH_API_KEY;
const enabled = process.env.LYNTAR_LIVE_TEST === '1';
const missing = [
  ...(enabled ? [] : ['LYNTAR_LIVE_TEST=1']),
  ...(endpoint ? [] : ['ASTRA_WEB_SEARCH_ENDPOINT']),
  ...(apiKey ? [] : ['ASTRA_WEB_SEARCH_API_KEY']),
];

describe('live Astra web search provider', () => {
  if (missing.length > 0) {
    it.skip(`[BLOCKED] configure ${missing.join(', ')}`, () => undefined);
    return;
  }

  it('normalizes a real provider response without exposing the provider credential', async () => {
    const provider = new HttpWebSearchProvider({
      id: 'configured-live-provider',
      endpoint: endpoint!,
      apiKey: apiKey!,
    });
    const service = new WebResearchService({ provider });
    const context: WebResearchContext = {
      taskId: 'live-web-search-certification',
      actorUserId: 'live-certification-user',
      billingContext: { kind: 'personal', userId: 'live-certification-user' },
    };

    const result = await service.search(
      {
        query: process.env.ASTRA_WEB_SEARCH_QUERY ?? 'official TypeScript documentation',
        maxResults: 3,
      },
      context,
    );

    expect(result.provider).toBe('configured-live-provider');
    expect(result.results.every((item) => item.url.startsWith('http'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(apiKey!);
  });
});
