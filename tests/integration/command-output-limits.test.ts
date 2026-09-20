import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalCommandRunner, LocalWorkspace } from '@lyntar/workspace';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('command output limits', () => {
  it('truncates large output and records the observed size', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-command-output-'));
    roots.push(root);
    await writeFile(join(root, 'output.js'), "process.stdout.write('x'.repeat(1000));\n");
    const workspace = await LocalWorkspace.open(root);
    const result = await new LocalCommandRunner(workspace.canonical).run(
      {
        executable: 'node',
        args: ['output.js'],
        cwdRelative: '.',
      },
      new AbortController().signal,
      { maxOutputBytes: 100 },
    );

    expect(result.truncated).toBe(true);
    expect(result.stdout).toHaveLength(100);
    expect(result.originalEstimatedSize).toBeGreaterThanOrEqual(1000);
  });
});
