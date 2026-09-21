import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertWorkspacePath,
  canonicalizeWorkspaceRoot,
  WorkspaceEscapeError,
} from '@astra/workspace';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('workspace path security', () => {
  it('rejects traversal and absolute Windows device paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astra-path-'));
    temporaryRoots.push(root);
    const workspace = await canonicalizeWorkspaceRoot(root);

    await expect(assertWorkspacePath(workspace, '../outside.txt', 'read')).rejects.toBeInstanceOf(
      WorkspaceEscapeError,
    );
    await expect(
      assertWorkspacePath(workspace, '\\\\?\\C:\\outside.txt', 'read'),
    ).rejects.toBeInstanceOf(WorkspaceEscapeError);
    await expect(
      assertWorkspacePath(workspace, '\\\\.\\C:\\outside.txt', 'read'),
    ).rejects.toBeInstanceOf(WorkspaceEscapeError);
  });

  it('rejects a junction that resolves outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astra-junction-'));
    const outside = await mkdtemp(join(tmpdir(), 'astra-outside-'));
    temporaryRoots.push(root, outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await mkdir(join(root, 'linked'));
    await rm(join(root, 'linked'), { recursive: true, force: true });
    await symlink(outside, join(root, 'linked'), 'junction');

    const workspace = await canonicalizeWorkspaceRoot(root);
    await expect(
      assertWorkspacePath(workspace, 'linked/secret.txt', 'read'),
    ).rejects.toBeInstanceOf(WorkspaceEscapeError);
  });

  it('rejects alternate data streams, reserved device names, and UNC paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astra-path-syntax-'));
    temporaryRoots.push(root);
    const workspace = await canonicalizeWorkspaceRoot(root);

    for (const value of ['file.txt:secret', 'CON.txt', 'nested\\AUX', '\\\\server\\share\\x']) {
      await expect(assertWorkspacePath(workspace, value, 'read')).rejects.toBeInstanceOf(
        WorkspaceEscapeError,
      );
    }
    await expect(
      assertWorkspacePath(workspace, 'safe/../outside.txt', 'read'),
    ).rejects.toBeInstanceOf(WorkspaceEscapeError);
  });

  it('rejects a workspace root replaced by a junction after selection', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'astra-root-replacement-'));
    const root = join(parent, 'workspace');
    const outside = join(parent, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    temporaryRoots.push(parent);

    const workspace = await canonicalizeWorkspaceRoot(root);
    await rm(root, { recursive: true, force: true });
    await symlink(outside, root, 'junction');

    await expect(assertWorkspacePath(workspace, 'secret.txt', 'read')).rejects.toBeInstanceOf(
      WorkspaceEscapeError,
    );
  });
});
