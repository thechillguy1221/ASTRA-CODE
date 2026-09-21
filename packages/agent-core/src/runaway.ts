import { createHash } from 'node:crypto';
import type { ModelDecision } from '@astra/contracts';

export class RunawayAgentError extends Error {
  constructor(public readonly fingerprint: string) {
    super('Agent paused: repeated identical action detected');
    this.name = 'RunawayAgentError';
  }
}

function fingerprintDecision(
  decision: Exclude<ModelDecision, { kind: 'finish' | 'message' }>,
): string {
  const stable = JSON.stringify(decision);
  return createHash('sha256').update(stable).digest('hex');
}

/** Stops a model/tool loop before it can consume an unbounded amount of spend. */
export class RunawayLoopGuard {
  private readonly repeats = new Map<string, number>();

  constructor(private readonly maxIdenticalActions = 3) {}

  observe(decision: ModelDecision): void {
    if (decision.kind === 'finish' || decision.kind === 'message') return;
    const fingerprint = fingerprintDecision(decision);
    const count = (this.repeats.get(fingerprint) ?? 0) + 1;
    this.repeats.set(fingerprint, count);
    if (count >= this.maxIdenticalActions) throw new RunawayAgentError(fingerprint);
  }
}
