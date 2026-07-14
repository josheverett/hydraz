import { existsSync, readFileSync, copyFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

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
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

export function listCopyableWorktreeIncludes(repoRoot: string, worktreeDir: string): string[] {
  const files = parseWorktreeInclude(repoRoot);
  const copyable: string[] = [];

  for (const file of files) {
    if (isAbsolute(file)) {
      throw new WorktreeIncludeError(`Refusing absolute path in .worktreeinclude: ${file}`);
    }

    const source = join(repoRoot, file);
    const destination = join(worktreeDir, file);

    if (!isWithin(repoRoot, source) || !isWithin(worktreeDir, destination)) {
      throw new WorktreeIncludeError(`Refusing .worktreeinclude entry outside the repository: ${file}`);
    }

    if (!existsSync(source)) {
      continue;
    }

    try {
      if (lstatSync(source).isSymbolicLink()) {
        throw new WorktreeIncludeError(`Refusing to copy symlink entry from .worktreeinclude: ${file}`);
      }

      const realRepoRoot = realpathSync(repoRoot);
      const realSource = realpathSync(source);
      if (!isWithin(realRepoRoot, realSource)) {
        throw new WorktreeIncludeError(
          `Refusing .worktreeinclude entry whose symlinked ancestor resolves outside the repository: ${file}`,
        );
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
