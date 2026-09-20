import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandRequest } from './command-policy.js';

export type ProjectKind = 'node' | 'python' | 'rust' | 'java' | 'flutter' | 'unknown';

export interface ProjectProfile {
  kind: ProjectKind;
  verificationCommand?: CommandRequest;
  candidateCommands: CommandRequest[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectProjectProfile(root: string): Promise<ProjectProfile> {
  const packagePath = join(root, 'package.json');
  if (await exists(packagePath)) {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const script = ['test', 'check', 'build'].find((name) => scripts[name]);
    return {
      kind: 'node',
      ...(script
        ? {
            verificationCommand: {
              executable: 'npm',
              args: script === 'test' ? ['test'] : ['run', script],
              cwdRelative: '.',
            },
          }
        : {}),
      candidateCommands: Object.keys(scripts).map((name) => ({
        executable: 'npm',
        args: name === 'test' ? ['test'] : ['run', name],
        cwdRelative: '.',
      })),
    };
  }
  if (
    (await exists(join(root, 'pyproject.toml'))) ||
    (await exists(join(root, 'requirements.txt')))
  )
    return { kind: 'python', candidateCommands: [] };
  if (await exists(join(root, 'Cargo.toml'))) return { kind: 'rust', candidateCommands: [] };
  if ((await exists(join(root, 'pom.xml'))) || (await exists(join(root, 'build.gradle'))))
    return { kind: 'java', candidateCommands: [] };
  if (await exists(join(root, 'pubspec.yaml'))) return { kind: 'flutter', candidateCommands: [] };
  return { kind: 'unknown', candidateCommands: [] };
}
