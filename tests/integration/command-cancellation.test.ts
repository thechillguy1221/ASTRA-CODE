import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalCommandRunner, LocalWorkspace } from '@astra/workspace';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('local command cancellation', () => {
  it('terminates a running Windows-compatible child process on abort', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astra-command-cancel-'));
    temporaryRoots.push(root);
    await writeFile(join(root, 'sleep.js'), 'setTimeout(() => {}, 30000);\n');
    const workspace = await LocalWorkspace.open(root);
    const controller = new AbortController();
    const pending = new LocalCommandRunner(workspace.canonical).run(
      { executable: 'node', args: ['sleep.js'], cwdRelative: '.' },
      controller.signal,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort('user stopped task');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
