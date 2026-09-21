import { describe, expect, it } from 'vitest';
import {
  addCredits,
  compareCredits,
  creditsFromUsd,
  creditsToUsd,
  subtractCredits,
} from '@astra/billing';

describe('fixed-point credit math', () => {
  it('converts provider USD amounts without floating-point drift', () => {
    expect(creditsFromUsd('0.001000')).toBe('0.1');
    expect(creditsFromUsd('0.027000')).toBe('2.7');
    expect(creditsFromUsd('0.037826')).toBe('3.7826');
    expect(creditsToUsd('3.7826')).toBe('0.037826');
  });

  it('adds and subtracts fractional credits exactly', () => {
    expect(addCredits('0.001', '37.825')).toBe('37.826');
    expect(subtractCredits('100', '37.826')).toBe('62.174');
    expect(compareCredits('62.174', '62.174')).toBe(0);
  });

  it('rejects negative and over-precision accounting values', () => {
    expect(() => creditsFromUsd('-0.01')).toThrow();
    expect(() => addCredits('1.00000001', '0')).toThrow();
    expect(() => subtractCredits('1', '2')).toThrow();
  });
});
