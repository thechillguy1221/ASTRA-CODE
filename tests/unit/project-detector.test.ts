import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectProjectProfile } from '@astra/workspace';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('project command detection', () => {
  it('selects the package test script for a Node project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astra-project-'));
    temporaryRoots.push(root);
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node test.js', build: 'tsc' } }),
    );
    const profile = await detectProjectProfile(root);
    expect(profile.kind).toBe('node');
    expect(profile.verificationCommand).toEqual({
      executable: 'npm',
      args: ['test'],
      cwdRelative: '.',
    });
  });

  it('does not guess npm test for an unsupported repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astra-project-'));
    temporaryRoots.push(root);
    await writeFile(join(root, 'notes.txt'), 'no manifest');
    const profile = await detectProjectProfile(root);
    expect(profile.verificationCommand).toBeUndefined();
  });
});
