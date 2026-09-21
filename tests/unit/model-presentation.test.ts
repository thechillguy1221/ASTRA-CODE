import { describe, expect, it } from 'vitest';
import type { ModelCatalogEntry } from '@astra/contracts';
import { modelPresentation } from '../../apps/desktop/src/renderer/model-presentation.js';

const model: ModelCatalogEntry = {
  modelId: 'claude-3-7-sonnet',
  displayName: 'Claude 3.7 Sonnet',
  gatewayModelId: 'anthropic/claude-3-7-sonnet',
  providerSlug: 'anthropic',
  provider: 'Anthropic',
  enabled: true,
  visible: true,
  capabilities: {
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: true,
    supportsStructuredOutput: true,
    supportsImageInput: false,
  },
};

describe('model presentation', () => {
  it('uses authoritative provider metadata and a stable provider icon key', () => {
    expect(modelPresentation(model)).toEqual({
      displayName: 'Claude 3.7 Sonnet',
      providerLabel: 'Anthropic',
      providerIcon: 'anthropic',
    });
  });

  it('normalizes provider slugs without inventing a model identity', () => {
    expect(
      modelPresentation({ ...model, provider: undefined, providerSlug: 'openai' }),
    ).toMatchObject({ providerLabel: 'OpenAI', providerIcon: 'openai' });
  });
});
