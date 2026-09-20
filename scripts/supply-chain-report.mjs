import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const workspaceDirectories = [
  root,
  ...rootPackage.workspaces.flatMap((pattern) => {
    const [parent] = pattern.split('/*');
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, parent, entry.name));
  }),
];
function packageMetadata(name, workspaceDirectory) {
  const requireFromWorkspace = createRequire(join(workspaceDirectory, 'package.json'));
  try {
    return JSON.parse(readFileSync(requireFromWorkspace.resolve(`${name}/package.json`), 'utf8'));
  } catch {
    try {
      let current = requireFromWorkspace.resolve(name);
      while (current !== dirname(current)) {
        const candidate = join(current, 'package.json');
        if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
        current = dirname(current);
      }
    } catch {
      return {};
    }
    return {};
  }
}

const entries = [];
for (const directory of workspaceDirectories) {
  const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  for (const dependencyType of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, requested] of Object.entries(packageJson[dependencyType] ?? {})) {
      const metadata = packageMetadata(name, directory);
      entries.push({
        workspace: packageJson.name,
        dependencyType,
        name,
        requested,
        installed: metadata.version ?? 'unresolved',
        license: metadata.license ?? metadata.licenses ?? 'unreported',
      });
    }
  }
}

entries.sort((left, right) =>
  `${left.name}:${left.workspace}`.localeCompare(`${right.name}:${right.workspace}`),
);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2));
