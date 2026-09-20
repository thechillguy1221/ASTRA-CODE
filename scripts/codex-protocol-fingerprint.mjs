import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'vendor/upstream/codex');
const sourceRoots = [
  'codex-rs/app-server-protocol/src',
  'codex-rs/app-server-client/src',
  'codex-rs/app-server-transport/src',
];

function filesUnder(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    return entry.isFile() && child.endsWith('.rs') ? [child] : [];
  });
}

const files = sourceRoots
  .flatMap((sourceRoot) => filesUnder(resolve(root, sourceRoot)))
  .sort((left, right) => left.localeCompare(right));
const digest = createHash('sha256');
for (const file of files) {
  digest.update(relative(root, file).replaceAll('\\', '/'));
  digest.update('\0');
  digest.update(readFileSync(file));
  digest.update('\0');
}

console.log(digest.digest('hex'));
console.error(`fingerprinted ${files.length} Codex protocol/runtime source files`);
