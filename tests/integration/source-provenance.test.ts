import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const provenancePath = resolve(root, 'docs/source-provenance.md');
const clinePath = resolve(root, 'vendor/upstream/cline');
const codexPath = resolve(root, 'vendor/upstream/codex');

describe('upstream source provenance', () => {
  it('records real pinned Cline and Codex checkouts and selected source paths', () => {
    expect(existsSync(clinePath)).toBe(true);
    expect(existsSync(codexPath)).toBe(true);
    expect(existsSync(provenancePath)).toBe(true);

    const provenance = readFileSync(provenancePath, 'utf8');
    expect(provenance).toMatch(/https:\/\/github\.com\/cline\/cline/);
    expect(provenance).toMatch(/https:\/\/github\.com\/openai\/codex/);
    expect(provenance).toMatch(/CLINE_SOURCE_SHA/);
    expect(provenance).toMatch(/CODEX_SOURCE_SHA/);
    expect(provenance).toMatch(/selected|imported|adapted/i);
  });
});
