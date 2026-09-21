import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { SafeGitWorktreeManager } from '@astra/orchestration';

const execFileAsync = promisify(execFile);
const temporaryRepositories: string[] = [];

async function git(cwd: string, args: string[]) {
  return execFileAsync('git', args, { cwd, windowsHide: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('safe git worktree manager', () => {
  it('creates and discards a clean isolated worktree without leaving the path behind', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'astra-worktree-repo-'));
    const worktreeRoot = join(repositoryRoot, '..', 'astra-worktrees');
    temporaryRepositories.push(repositoryRoot, worktreeRoot);
    await git(repositoryRoot, ['init', '-b', 'main']);
    await git(repositoryRoot, ['config', 'user.email', 'astra-test@example.test']);
    await git(repositoryRoot, ['config', 'user.name', 'Astra Test']);
    await writeFile(join(repositoryRoot, 'README.md'), 'fixture\n', 'utf8');
    await git(repositoryRoot, ['add', 'README.md']);
    await git(repositoryRoot, ['commit', '-m', 'fixture']);

    const manager = new SafeGitWorktreeManager();
    const record = await manager.create({
      taskId: 'task-one',
      repositoryRoot,
      worktreeRoot,
      baseRevision: 'HEAD',
    });
    expect(await exists(record.path)).toBe(true);

    await expect(manager.discard(record)).resolves.toBeUndefined();
    expect(await exists(record.path)).toBe(false);
  });
});
