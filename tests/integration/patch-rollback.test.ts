import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWorkspace, PatchApplicationError, WorkspaceEscapeError } from '@lyntar/workspace';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('atomic patching', () => {
  it('restores the original bytes when a later file in a patch batch fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-patch-'));
    temporaryRoots.push(root);
    await writeFile(join(root, 'a.txt'), 'old-a');
    await writeFile(join(root, 'blocked'), 'not a directory');
    const workspace = await LocalWorkspace.open(root);

    await expect(
      workspace.writeBatch({
        files: [
          { path: 'a.txt', content: 'new-a' },
          { path: 'blocked/b.txt', content: 'new-b' },
        ],
      }),
    ).rejects.toBeInstanceOf(PatchApplicationError);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('old-a');
  });

  it('writes binary Room import content atomically under the workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-binary-'));
    temporaryRoots.push(root);
    const workspace = await LocalWorkspace.open(root);
    const bytes = Buffer.from([0, 255, 1, 2, 3, 254]);

    await workspace.writeBufferBatch([{ path: 'assets/logo.bin', content: bytes }]);

    expect(await readFile(join(root, 'assets/logo.bin'))).toEqual(bytes);
    await expect(
      workspace.writeBufferBatch([
        { path: 'assets/next.bin', content: Buffer.from([9]) },
        { path: '../escape.bin', content: Buffer.from([8]) },
      ]),
    ).rejects.toBeInstanceOf(WorkspaceEscapeError);
    await expect(readFile(join(root, 'assets/next.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
