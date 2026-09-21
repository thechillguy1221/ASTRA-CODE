import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.ASTRA_FORMAT_BASE ?? 'HEAD~1';
const supported = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.scss',
  '.md',
  '.json',
  '.mjs',
  '.cjs',
  '.yml',
  '.yaml',
  '.html',
]);
const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base, '--'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter(
    (file) =>
      file &&
      file !== 'package-lock.json' &&
      supported.has(file.slice(file.lastIndexOf('.')).toLowerCase()) &&
      existsSync(resolve(file)),
  );

if (changed.length === 0) {
  console.log(`[FORMAT-CHANGED] no supported files changed from ${base}`);
  process.exit(0);
}

const prettier = resolve('node_modules', 'prettier', 'bin', 'prettier.cjs');
const result = spawnSync(process.execPath, [prettier, '--check', ...changed], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
