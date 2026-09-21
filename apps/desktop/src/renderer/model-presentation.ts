import type { ModelCatalogEntry } from '@astra/contracts';

export type ProviderIconKey =
  'openai' | 'anthropic' | 'google' | 'xai' | 'mistral' | 'deepseek' | 'cohere' | 'generic';

const PROVIDER_LABELS: Record<string, { label: string; icon: ProviderIconKey }> = {
  openai: { label: 'OpenAI', icon: 'openai' },
  anthropic: { label: 'Anthropic', icon: 'anthropic' },
  google: { label: 'Google', icon: 'google' },
  gemini: { label: 'Google', icon: 'google' },
  xai: { label: 'xAI', icon: 'xai' },
  grok: { label: 'xAI', icon: 'xai' },
  mistral: { label: 'Mistral', icon: 'mistral' },
  deepseek: { label: 'DeepSeek', icon: 'deepseek' },
  cohere: { label: 'Cohere', icon: 'cohere' },
};

function providerKey(model: ModelCatalogEntry): string {
  return (model.provider ?? model.providerSlug).trim().toLowerCase().replaceAll(' ', '-');
}

export function modelPresentation(model: ModelCatalogEntry): {
  displayName: string;
  providerLabel: string;
  providerIcon: ProviderIconKey;
} {
  const key = providerKey(model);
  const known = PROVIDER_LABELS[key] ?? PROVIDER_LABELS[key.split('-')[0] ?? ''];
  return {
    displayName: model.displayName,
    providerLabel: known?.label ?? model.provider ?? model.providerSlug,
    providerIcon: known?.icon ?? 'generic',
  };
}

export function providerMark(icon: ProviderIconKey): string {
  switch (icon) {
    case 'openai':
      return 'OAI';
    case 'anthropic':
      return 'A';
    case 'google':
      return 'G';
    case 'xai':
      return 'x';
    case 'mistral':
      return 'M';
    case 'deepseek':
      return 'D';
    case 'cohere':
      return 'C';
    default:
      return 'AI';
  }
}
