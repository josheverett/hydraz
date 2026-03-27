import { existsSync, readFileSync, copyFileSync, mkdirSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export class WorktreeIncludeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeIncludeError';
  }
}

export function parseWorktreeInclude(repoRoot: string): string[] {
  const includeFile = join(repoRoot, '.worktreeinclude');

  if (!existsSync(includeFile)) {
    return [];
  }

  return readFileSync(includeFile, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function isWithin(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent) + '/';
  const resolvedChild = resolve(child);
  return resolvedChild.startsWith(resolvedParent);
}

export function listCopyableWorktreeIncludes(repoRoot: string, worktreeDir: string): string[] {
  const files = parseWorktreeInclude(repoRoot);
  const copyable: string[] = [];

  for (const file of files) {
    const source = join(repoRoot, file);
    const destination = join(worktreeDir, file);

    if (!isWithin(repoRoot, source) || !isWithin(worktreeDir, destination)) {
      continue;
    }

    if (!existsSync(source)) {
      continue;
    }

    try {
      if (lstatSync(source).isSymbolicLink()) {
        throw new WorktreeIncludeError(`Refusing to copy symlink entry from .worktreeinclude: ${file}`);
      }
    } catch (err) {
      if (err instanceof WorktreeIncludeError) {
        throw err;
      }
      throw new WorktreeIncludeError(`Unable to verify .worktreeinclude entry: ${file}`);
    }

    copyable.push(file);
  }

  return copyable;
}

export function copyWorktreeIncludes(repoRoot: string, worktreeDir: string): string[] {
  const files = listCopyableWorktreeIncludes(repoRoot, worktreeDir);

  for (const file of files) {
    const source = join(repoRoot, file);
    const dest = join(worktreeDir, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
  }

  return files;
}
