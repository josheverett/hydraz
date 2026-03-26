import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

export interface RepoInfo {
  root: string;
  name: string;
}

export function detectRepo(cwd?: string): RepoInfo | null {
  let dir = resolve(cwd ?? process.cwd());

  while (true) {
    if (existsSync(resolve(dir, '.git'))) {
      return {
        root: dir,
        name: basename(dir),
      };
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export function hasGitRemote(repoRoot: string): boolean {
  try {
    const output = execFileSync('git', ['remote'], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}
