import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { GitBaselineSchema, type GitBaseline, type GitDiff } from '@lyntar/contracts';

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', root, ...args], {
    windowsHide: true,
    maxBuffer: 2_000_000,
  });
  return result.stdout;
}

async function gitDiff(root: string, args: string[]): Promise<string> {
  try {
    return await git(root, args);
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { stdout?: string };
    if (String(commandError.code) === '1' && typeof commandError.stdout === 'string')
      return commandError.stdout;
    throw error;
  }
}

function statusPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1) ?? '')
    .filter(Boolean)
    .map((value) => value.replaceAll('\\', '/'));
}

async function hashFile(root: string, relativePath: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(`${root}/${relativePath}`);
    return createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export class GitWorkspace {
  private constructor(private readonly root: string) {}

  get repositoryRoot(): string {
    return this.root;
  }

  static async open(root: string): Promise<GitWorkspace> {
    const repositoryRoot = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    return new GitWorkspace(repositoryRoot);
  }

  async captureBaseline(): Promise<GitBaseline> {
    const [headOutput, statusOutput] = await Promise.all([
      git(this.root, ['rev-parse', 'HEAD']).catch(() => ''),
      git(this.root, ['status', '--porcelain=v1', '--untracked-files=all']),
    ]);
    const paths = statusPaths(statusOutput);
    const fileHashes: Record<string, string> = {};
    for (const path of paths) {
      const hash = await hashFile(this.root, path);
      if (hash) fileHashes[path] = hash;
    }
    return GitBaselineSchema.parse({
      repositoryRoot: this.root,
      head: headOutput.trim() || null,
      statusPaths: paths,
      fileHashes,
      capturedAt: new Date().toISOString(),
    });
  }

  async diffFromBaseline(baseline: GitBaseline): Promise<GitDiff> {
    const after = statusPaths(
      await git(this.root, ['status', '--porcelain=v1', '--untracked-files=all']),
    );
    const afterHashes: Record<string, string | undefined> = {};
    for (const path of after) afterHashes[path] = await hashFile(this.root, path);
    const baselineSet = new Set(baseline.statusPaths);
    const afterSet = new Set(after);
    const preExistingPaths: string[] = [];
    const mixedPaths: string[] = [];
    const lyntarPaths: string[] = [];
    for (const path of after) {
      if (!baselineSet.has(path)) {
        lyntarPaths.push(path);
      } else if (baseline.fileHashes[path] !== afterHashes[path]) {
        mixedPaths.push(path);
      } else {
        preExistingPaths.push(path);
      }
    }
    for (const path of baseline.statusPaths) {
      if (!afterSet.has(path)) preExistingPaths.push(path);
    }
    const patchParts = await Promise.all(
      lyntarPaths.map((path) =>
        baselineSet.has(path)
          ? gitDiff(this.root, ['diff', '--binary', '--', path])
          : gitDiff(this.root, ['diff', '--binary', '--no-index', '--', '/dev/null', path]),
      ),
    );
    const patch = patchParts.join('');
    return { lyntarPaths, preExistingPaths, mixedPaths, patch };
  }
}
