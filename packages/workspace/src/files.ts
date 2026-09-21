import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertWorkspacePath,
  canonicalizeWorkspaceRoot,
  WorkspaceEscapeError,
  type CanonicalWorkspace,
} from './path-security.js';

const MAX_FILE_READ_BYTES = 200_000;
const MAX_SEARCH_RESULTS = 1_000;

export interface FilePatch {
  path: string;
  content: string;
}

export interface FilePatchBatch {
  files: FilePatch[];
}

export interface BinaryFilePatch {
  path: string;
  content: Buffer;
}

export interface PatchResult {
  paths: string[];
  rolledBack: boolean;
}

export class PatchApplicationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PatchApplicationError';
  }
}

interface Backup {
  path: string;
  existed: boolean;
  bytes?: Buffer;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error(
    signal.reason instanceof Error ? signal.reason.message : 'Patch cancelled',
  );
  error.name = 'AbortError';
  throw error;
}

export class LocalWorkspace {
  private constructor(public readonly canonical: CanonicalWorkspace) {}

  static async open(root: string): Promise<LocalWorkspace> {
    return new LocalWorkspace(await canonicalizeWorkspaceRoot(root));
  }

  async readFile(relativePath: string): Promise<string> {
    const absolute = await assertWorkspacePath(this.canonical, relativePath, 'read');
    const confirmed = await assertWorkspacePath(this.canonical, relativePath, 'read');
    if (confirmed.toLowerCase() !== absolute.toLowerCase())
      throw new WorkspaceEscapeError(relativePath);
    const bytes = await readFile(confirmed);
    if (bytes.byteLength <= MAX_FILE_READ_BYTES) return bytes.toString('utf8');
    return `${bytes.subarray(0, MAX_FILE_READ_BYTES).toString('utf8')}\n[truncated]`;
  }

  async listFiles(): Promise<string[]> {
    await assertWorkspacePath(this.canonical, '.', 'read');
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist')
          continue;
        const absolute = win32.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile())
          files.push(relative(this.canonical.root, absolute).replaceAll('\\', '/'));
      }
    };
    await visit(this.canonical.root);
    return files.sort();
  }

  async search(query: string): Promise<Array<{ path: string; line: number; text: string }>> {
    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const relativePath of await this.listFiles()) {
      const content = await this.readFile(relativePath);
      content.split(/\r?\n/).forEach((text, index) => {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        if (text.toLowerCase().includes(query.toLowerCase())) {
          results.push({ path: relativePath, line: index + 1, text: text.slice(0, 500) });
        }
      });
    }
    return results;
  }

  async writeBatch(batch: FilePatchBatch, signal?: AbortSignal): Promise<PatchResult> {
    if (batch.files.length === 0) return { paths: [], rolledBack: false };
    throwIfAborted(signal);
    const writes = await Promise.all(
      batch.files.map(async (file) => ({
        file,
        absolute: await assertWorkspacePath(this.canonical, file.path, 'write'),
      })),
    );
    const backups: Backup[] = [];
    const temporaryFiles: string[] = [];

    try {
      for (const { file, absolute } of writes) {
        throwIfAborted(signal);
        const confirmed = await assertWorkspacePath(this.canonical, file.path, 'write');
        if (confirmed.toLowerCase() !== absolute.toLowerCase())
          throw new WorkspaceEscapeError(file.path);
        try {
          backups.push({ path: confirmed, existed: true, bytes: await readFile(confirmed) });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          backups.push({ path: confirmed, existed: false });
        }

        await mkdir(dirname(confirmed), { recursive: true });
        const temporary = `${confirmed}.${randomUUID()}.lyntar-tmp`;
        temporaryFiles.push(temporary);
        await writeFile(temporary, file.content, 'utf8');
        throwIfAborted(signal);
        const beforeCommit = await assertWorkspacePath(this.canonical, file.path, 'write');
        if (beforeCommit.toLowerCase() !== confirmed.toLowerCase())
          throw new WorkspaceEscapeError(file.path);
        await rm(beforeCommit, { force: true });
        await rename(temporary, beforeCommit);
      }
      throwIfAborted(signal);
      return { paths: writes.map(({ file }) => file.path), rolledBack: false };
    } catch (error) {
      for (const temporary of temporaryFiles)
        await rm(temporary, { force: true }).catch(() => undefined);
      for (const backup of backups.reverse()) {
        if (backup.existed && backup.bytes !== undefined) {
          await writeFile(backup.path, backup.bytes);
        } else {
          await rm(backup.path, { force: true });
        }
      }
      throw new PatchApplicationError('Patch batch was rolled back', { cause: error });
    }
  }

  async writeBufferBatch(files: BinaryFilePatch[], signal?: AbortSignal): Promise<PatchResult> {
    if (files.length === 0) return { paths: [], rolledBack: false };
    throwIfAborted(signal);
    const writes = await Promise.all(
      files.map(async (file) => ({
        file,
        absolute: await assertWorkspacePath(this.canonical, file.path, 'write'),
      })),
    );
    const backups: Backup[] = [];
    const temporaryFiles: string[] = [];

    try {
      for (const { file, absolute } of writes) {
        throwIfAborted(signal);
        const confirmed = await assertWorkspacePath(this.canonical, file.path, 'write');
        if (confirmed.toLowerCase() !== absolute.toLowerCase())
          throw new WorkspaceEscapeError(file.path);
        try {
          backups.push({ path: confirmed, existed: true, bytes: await readFile(confirmed) });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          backups.push({ path: confirmed, existed: false });
        }

        await mkdir(dirname(confirmed), { recursive: true });
        const temporary = `${confirmed}.${randomUUID()}.lyntar-tmp`;
        temporaryFiles.push(temporary);
        await writeFile(temporary, file.content);
        throwIfAborted(signal);
        const beforeCommit = await assertWorkspacePath(this.canonical, file.path, 'write');
        if (beforeCommit.toLowerCase() !== confirmed.toLowerCase())
          throw new WorkspaceEscapeError(file.path);
        await rm(beforeCommit, { force: true });
        await rename(temporary, beforeCommit);
      }
      throwIfAborted(signal);
      return { paths: writes.map(({ file }) => file.path), rolledBack: false };
    } catch (error) {
      for (const temporary of temporaryFiles)
        await rm(temporary, { force: true }).catch(() => undefined);
      for (const backup of backups.reverse()) {
        if (backup.existed && backup.bytes !== undefined)
          await writeFile(backup.path, backup.bytes);
        else await rm(backup.path, { force: true });
      }
      throw new PatchApplicationError('Binary file batch was rolled back', { cause: error });
    }
  }

  async fileExists(relativePath: string): Promise<boolean> {
    const absolute = await assertWorkspacePath(this.canonical, relativePath, 'read');
    const confirmed = await assertWorkspacePath(this.canonical, relativePath, 'read');
    if (confirmed.toLowerCase() !== absolute.toLowerCase())
      throw new WorkspaceEscapeError(relativePath);
    try {
      await stat(confirmed);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
