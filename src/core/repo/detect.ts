import { existsSync } from 'node:fs';
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
