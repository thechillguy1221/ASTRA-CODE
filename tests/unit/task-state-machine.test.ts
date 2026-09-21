import { describe, expect, it } from 'vitest';
import { assertTaskTransition } from '@astra/contracts';

describe('task state machine', () => {
  it('rejects an illegal COMPLETED to EXECUTING transition', () => {
    expect(() => assertTaskTransition('COMPLETED', 'EXECUTING')).toThrow(/Invalid task transition/);
  });

  it('allows a verification failure to enter bounded repair', () => {
    expect(() => assertTaskTransition('VERIFYING', 'REPAIRING')).not.toThrow();
  });
});
