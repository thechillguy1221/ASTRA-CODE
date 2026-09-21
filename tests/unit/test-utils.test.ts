import { describe, expect, it } from 'vitest';
import { DeterministicModel } from '@astra/test-utils';

describe('deterministic test utilities', () => {
  it('returns configured structured decisions in order', async () => {
    const model = new DeterministicModel([
      { kind: 'message', summary: 'Inspecting repository' },
      { kind: 'finish', summary: 'Done' },
    ]);
    const signal = new AbortController().signal;
    const first = [];
    for await (const event of model.complete(
      { requestId: 'r1', taskId: 't1', modelId: 'm1', messages: [] },
      signal,
    ))
      first.push(event);
    const second = [];
    for await (const event of model.complete(
      { requestId: 'r2', taskId: 't1', modelId: 'm1', messages: [] },
      signal,
    ))
      second.push(event);
    expect(first[0].decision.summary).toBe('Inspecting repository');
    expect(second[0].decision.kind).toBe('finish');
  });
});
