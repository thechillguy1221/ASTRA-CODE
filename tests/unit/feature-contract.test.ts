import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contractPath = resolve(import.meta.dirname, '../../docs/product/feature-contract-v1.md');

describe('Astra Feature 1-65 contract', () => {
  it('contains every feature ID exactly once', () => {
    const contract = readFileSync(contractPath, 'utf8');
    const ids = [...contract.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((match) => Number(match[1]));
    expect(ids).toHaveLength(65);
    expect(new Set(ids).size).toBe(65);
    expect(ids).toEqual(Array.from({ length: 65 }, (_, index) => index + 1));
  });
});
