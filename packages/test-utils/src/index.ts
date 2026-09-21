import type { ModelPort } from '@astra/agent-core';
import type { ModelDecision, ModelRequest } from '@astra/contracts';

export class DeterministicModel implements ModelPort {
  private readonly remaining: ModelDecision[];

  constructor(decisions: ModelDecision[]) {
    this.remaining = [...decisions];
  }

  async *complete(_request: ModelRequest, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason ?? new Error('Model request cancelled');
    const decision = this.remaining.shift();
    if (!decision) throw new Error('Deterministic model exhausted');
    yield { type: 'decision' as const, decision };
  }
}
