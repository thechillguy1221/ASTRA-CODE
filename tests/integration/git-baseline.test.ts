import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorkspace } from '@lyntar/workspace';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function git(root: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args], { windowsHide: true });
}

describe('Git baseline and diff ownership', () => {
  it('marks an existing dirty file as pre-existing and excludes it from the Lyntar diff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-git-'));
    temporaryRoots.push(root);
    await git(root, 'init');
    await git(root, 'config', 'user.email', 'test@lyntar.local');
    await git(root, 'config', 'user.name', 'Lyntar Test');
    await writeFile(join(root, 'README.md'), 'original\n');
    await writeFile(join(root, 'app.txt'), 'before\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'fixture');
    await writeFile(join(root, 'README.md'), 'pre-existing edit\n');

    const gitWorkspace = await GitWorkspace.open(root);
    const baseline = await gitWorkspace.captureBaseline();
    await writeFile(join(root, 'app.txt'), 'Lyntar edit\n');
    const diff = await gitWorkspace.diffFromBaseline(baseline);

    expect(diff.preExistingPaths).toContain('README.md');
    expect(diff.lyntarPaths).toContain('app.txt');
    expect(diff.lyntarPaths).not.toContain('README.md');
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('pre-existing edit\n');
  });

  it('includes a newly created Lyntar file in the isolated patch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-git-new-'));
    temporaryRoots.push(root);
    await git(root, 'init');
    await git(root, 'config', 'user.email', 'test@lyntar.local');
    await git(root, 'config', 'user.name', 'Lyntar Test');
    await writeFile(join(root, 'README.md'), 'fixture\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'fixture');

    const gitWorkspace = await GitWorkspace.open(root);
    const baseline = await gitWorkspace.captureBaseline();
    await writeFile(join(root, 'created.txt'), 'created by Lyntar\n');
    const diff = await gitWorkspace.diffFromBaseline(baseline);

    expect(diff.lyntarPaths).toEqual(['created.txt']);
    expect(diff.patch).toContain('created by Lyntar');
  });

  it('marks a file touched by both the user and Lyntar as mixed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-git-mixed-'));
    temporaryRoots.push(root);
    await git(root, 'init');
    await git(root, 'config', 'user.email', 'test@lyntar.local');
    await git(root, 'config', 'user.name', 'Lyntar Test');
    await writeFile(join(root, 'app.txt'), 'original\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'fixture');
    await writeFile(join(root, 'app.txt'), 'user edit\n');

    const gitWorkspace = await GitWorkspace.open(root);
    const baseline = await gitWorkspace.captureBaseline();
    await writeFile(join(root, 'app.txt'), 'user edit plus Lyntar edit\n');
    const diff = await gitWorkspace.diffFromBaseline(baseline);

    expect(diff.mixedPaths).toEqual(['app.txt']);
    expect(diff.lyntarPaths).not.toContain('app.txt');
    expect(diff.patch).toBe('');
  });
});
