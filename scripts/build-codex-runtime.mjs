import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const codexRoot = resolve(root, 'vendor/upstream/codex');
const manifestPath = resolve(root, 'apps/desktop/resources/codex/codex-runtime.json');

if (!existsSync(resolve(codexRoot, 'codex-rs/Cargo.toml')))
  throw new Error(
    'Pinned Codex submodule is unavailable; run git submodule update --init --recursive',
  );

const result = spawnSync(
  process.platform === 'win32' ? 'cargo.exe' : 'cargo',
  [
    'build',
    '--release',
    '--manifest-path',
    resolve(codexRoot, 'codex-rs/Cargo.toml'),
    '-p',
    'codex-app-server',
  ],
  { cwd: codexRoot, stdio: 'inherit', shell: false },
);

if (result.error) throw new Error(`Codex build tool unavailable: ${result.error.message}`);
if (result.status !== 0)
  throw new Error(`Pinned Codex app-server build failed with exit code ${result.status}`);
if (!existsSync(manifestPath))
  throw new Error(`Codex build completed but runtime manifest is missing: ${manifestPath}`);

console.log(
  'Pinned Codex app-server build completed; packaging manifest validation remains required.',
);
