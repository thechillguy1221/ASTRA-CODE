import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd());
const legacyToken = ['l', 'y', 'n', 't', 'a', 'r'].join('');

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

function filesWithLegacyContent(files: string[]): string[] {
  return files.filter((file) => {
    const absolutePath = join(repositoryRoot, file);
    if (!statSync(absolutePath).isFile()) return false;
    const content = readFileSync(absolutePath);
    if (content.includes(0)) return false;
    return content.toString('utf8').toLowerCase().includes(legacyToken);
  });
}

describe('Astra repository branding', () => {
  it('contains no legacy product token in tracked paths or text', () => {
    const files = trackedFiles();
    const legacyPaths = files.filter((file) => file.toLowerCase().includes(legacyToken));
    const legacyContent = filesWithLegacyContent(files);

    expect({ legacyPaths, legacyContent }).toEqual({ legacyPaths: [], legacyContent: [] });
  });
});
