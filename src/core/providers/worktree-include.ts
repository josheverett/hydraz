import { existsSync, readFileSync, copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

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

export function copyWorktreeIncludes(repoRoot: string, worktreeDir: string): string[] {
  const files = parseWorktreeInclude(repoRoot);
  const copied: string[] = [];

  for (const file of files) {
    const source = join(repoRoot, file);
    const dest = join(worktreeDir, file);

    if (!isWithin(repoRoot, source) || !isWithin(worktreeDir, dest)) {
      continue;
    }

    if (!existsSync(source)) {
      continue;
    }

    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    copied.push(file);
  }

  return copied;
}
