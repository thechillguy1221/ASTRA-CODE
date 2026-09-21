import { execFile } from 'node:child_process';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute } from 'node:path';
import { WorktreeRecordSchema, type WorktreeRecord } from './contracts.js';
const execFileAsync = promisify(execFile);
export interface WorktreeManager {
  create(input: {
    taskId: string;
    repositoryRoot: string;
    worktreeRoot: string;
    baseRevision: string;
  }): Promise<WorktreeRecord>;
  inspect(record: WorktreeRecord): Promise<{ status: string; diff: string }>;
  discard(record: WorktreeRecord): Promise<void>;
}
function assertWithin(root: string, target: string): void {
  const relativePath = relative(root.toLowerCase(), target.toLowerCase());
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new Error('Worktree path escapes the authorized worktree root');
}
function assertTaskId(taskId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/.test(taskId)) throw new Error('Invalid task ID');
}
async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 2_000_000 });
  return result.stdout.trim();
}
export class SafeGitWorktreeManager implements WorktreeManager {
  async create(input: {
    taskId: string;
    repositoryRoot: string;
    worktreeRoot: string;
    baseRevision: string;
  }): Promise<WorktreeRecord> {
    assertTaskId(input.taskId);
    const repositoryRoot = await realpath(input.repositoryRoot);
    const worktreeRoot = resolve(input.worktreeRoot);
    await mkdir(worktreeRoot, { recursive: true });
    const branch = `astra/task/${input.taskId}`;
    const path = resolve(worktreeRoot, input.taskId);
    assertWithin(worktreeRoot, path);
    if (await git(repositoryRoot, ['status', '--porcelain']))
      throw new Error('Repository is dirty; refusing to create an isolated task worktree');
    await git(repositoryRoot, ['worktree', 'add', '-b', branch, path, input.baseRevision]);
    const now = new Date().toISOString();
    return WorktreeRecordSchema.parse({
      id: `wt_${input.taskId}`,
      taskId: input.taskId,
      repositoryRoot,
      path,
      branch,
      baseRevision: input.baseRevision,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
  }
  async inspect(record: WorktreeRecord): Promise<{ status: string; diff: string }> {
    const root = await realpath(record.repositoryRoot);
    const path = await realpath(record.path);
    assertWithin(root, path);
    return {
      status: await git(path, ['status', '--short']),
      diff: await git(path, ['diff', '--no-ext-diff', '--binary', '--no-color']),
    };
  }
  async discard(record: WorktreeRecord): Promise<void> {
    const root = await realpath(record.repositoryRoot);
    const path = await realpath(record.path);
    assertWithin(root, path);
    if (await git(path, ['status', '--porcelain']))
      throw new Error('Refusing to discard a dirty task worktree');
    await git(root, ['worktree', 'remove', path]);
    await rm(path, { recursive: true, force: false });
  }
}
