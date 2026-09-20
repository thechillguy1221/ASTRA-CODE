import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const provenancePath = resolve(root, 'docs/source-provenance.md');
const provenance = readFileSync(provenancePath, 'utf8');

const required = [
  ['Cline repository', 'https://github.com/cline/cline'],
  ['Codex repository', 'https://github.com/openai/codex'],
  ['Cline SHA', /CLINE_SOURCE_SHA`?:\s*`?[0-9a-f]{40}/i],
  ['Codex SHA', /CODEX_SOURCE_SHA`?:\s*`?[0-9a-f]{40}/i],
  ['Cline selected paths', /CLINE_SELECTED_SOURCE_PATHS/],
  ['Codex selected paths', /CODEX_SELECTED_SOURCE_PATHS/],
  ['Cline integration status', /CLINE_PRODUCTION_INTEGRATION_STATUS/],
  ['Codex integration status', /CODEX_PRODUCTION_INTEGRATION_STATUS/],
];

for (const [label, pattern] of required) {
  const present =
    typeof pattern === 'string' ? provenance.includes(pattern) : pattern.test(provenance);
  if (!present) {
    throw new Error(`source provenance missing ${label}`);
  }
}

for (const [label, path] of [
  ['Cline checkout', 'vendor/upstream/cline'],
  ['Codex checkout', 'vendor/upstream/codex'],
  ['Cline license', 'vendor/upstream/cline/LICENSE'],
  ['Codex license', 'vendor/upstream/codex/LICENSE'],
  ['Codex notice', 'vendor/upstream/codex/NOTICE'],
]) {
  if (!existsSync(resolve(root, path))) {
    throw new Error(`source provenance missing ${label}: ${path}`);
  }
}

console.log('Source provenance checks passed for pinned acquisitions.');
