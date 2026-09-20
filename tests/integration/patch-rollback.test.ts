import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWorkspace, PatchApplicationError } from '@lyntar/workspace';

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
});
