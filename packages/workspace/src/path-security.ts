import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute as posixIsAbsolute, win32 } from 'node:path';

export class WorkspaceEscapeError extends Error {
  constructor(pathValue: string) {
    super(`Workspace path is not authorized: ${pathValue}`);
    this.name = 'WorkspaceEscapeError';
  }
}

export interface CanonicalWorkspace {
  root: string;
  isUnc: boolean;
  rootIdentity?: string;
}

function normalizedWindows(value: string): string {
  return value.replaceAll('/', '\\');
}

function isDeviceOrAbsolute(value: string): boolean {
  const normalized = normalizedWindows(value);
  return (
    normalized.startsWith('\\\\?\\') ||
    normalized.startsWith('\\\\.\\') ||
    normalized.startsWith('\\') ||
    win32.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    posixIsAbsolute(value)
  );
}

function hasUnsafeWindowsSyntax(value: string): boolean {
  const segments = normalizedWindows(value)
    .split(/[\\/]+/)
    .filter(Boolean);
  return segments.some((segment) => {
    if (segment.includes(':') || /[<>"|?*]/.test(segment)) return true;
    if (segment !== '.' && /[. ]$/.test(segment)) return true;
    const baseName = segment.split('.')[0]?.toLowerCase();
    return Boolean(baseName && /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(baseName));
  });
}

function identityOf(stats: { dev: number; ino: number }): string {
  return `${stats.dev}:${stats.ino}`;
}

function isContained(root: string, candidate: string): boolean {
  const rootLower = win32.normalize(root).toLowerCase();
  const candidateLower = win32.normalize(candidate).toLowerCase();
  const relative = win32.relative(rootLower, candidateLower);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${win32.sep}`) && !win32.isAbsolute(relative))
  );
}

async function resolveThroughExistingParent(candidate: string): Promise<string> {
  let current = candidate;
  const missingSegments: string[] = [];

  while (true) {
    try {
      await lstat(current);
      const resolved = await realpath(current);
      return missingSegments.reduce((parent, segment) => win32.join(parent, segment), resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(win32.basename(current));
      current = parent;
    }
  }
}

export async function canonicalizeWorkspaceRoot(input: string): Promise<CanonicalWorkspace> {
  const normalizedInput = normalizedWindows(input);
  if (!input || normalizedInput.startsWith('\\\\?\\') || normalizedInput.startsWith('\\\\.\\')) {
    throw new WorkspaceEscapeError(input);
  }
  const canonical = await realpath(input);
  const rootStats = await stat(canonical);
  if (!rootStats.isDirectory()) throw new WorkspaceEscapeError(input);
  return {
    root: win32.normalize(canonical),
    isUnc: canonical.startsWith('\\\\'),
    rootIdentity: identityOf(rootStats),
  };
}

export async function assertWorkspacePath(
  workspace: CanonicalWorkspace,
  relativePath: string,
  mode: 'read' | 'write',
): Promise<string> {
  void mode;
  const segments = normalizedWindows(relativePath).split(/[\\/]+/);
  if (
    !relativePath ||
    relativePath.includes('\0') ||
    isDeviceOrAbsolute(relativePath) ||
    hasUnsafeWindowsSyntax(relativePath) ||
    segments.includes('..')
  ) {
    throw new WorkspaceEscapeError(relativePath);
  }

  let currentRoot: string;
  try {
    currentRoot = await realpath(workspace.root);
    const currentRootStats = await stat(currentRoot);
    if (
      !isContained(workspace.root, currentRoot) ||
      (workspace.rootIdentity && identityOf(currentRootStats) !== workspace.rootIdentity)
    )
      throw new WorkspaceEscapeError(relativePath);
  } catch (error) {
    if (error instanceof WorkspaceEscapeError) throw error;
    throw new WorkspaceEscapeError(relativePath);
  }
  const normalized = normalizedWindows(relativePath);
  const candidate = win32.resolve(currentRoot, normalized);
  const resolved = await resolveThroughExistingParent(candidate);
  if (!isContained(workspace.root, resolved)) throw new WorkspaceEscapeError(relativePath);
  return resolved;
}
