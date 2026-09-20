/* global process */

const LIVE_REQUIRED_KEYS = [
  'LYNTAR_LIVE_TEST',
  'LYNTAR_MODEL_GATEWAY_URL',
  'LYNTAR_MODEL_GATEWAY_API_KEY',
  'LYNTAR_MODEL_ID',
];

export function resolveLiveConfiguration(environment = process.env) {
  const missing = LIVE_REQUIRED_KEYS.filter((key) => {
    if (key === 'LYNTAR_LIVE_TEST') return environment[key] !== '1';
    return !environment[key];
  });
  if (missing.length > 0) {
    return { status: 'BLOCKED', missing };
  }
  return {
    status: 'READY',
    credentials: {
      baseUrl: environment.LYNTAR_MODEL_GATEWAY_URL,
      apiKey: environment.LYNTAR_MODEL_GATEWAY_API_KEY,
      modelId: environment.LYNTAR_MODEL_ID,
    },
  };
}

export async function runCertification({ liveCredentials } = {}) {
  const liveModel = liveCredentials
    ? { status: 'UNVERIFIED', reason: 'Live smoke result has not been recorded' }
    : { status: 'BLOCKED', reason: 'Live Gateway credentials are not configured' };
  return {
    deterministic: { status: 'VERIFIED' },
    liveModel,
    verdict: liveModel.status === 'PASS' ? 'CERTIFIED' : 'NOT_CERTIFIED',
  };
}
