import { lstatSync } from 'node:fs';

export class ConfigPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigPathError';
  }
}

export function assertConfigPathNotSymlink(path: string, label: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new ConfigPathError(`Refusing to use ${label}: path is a symlink`);
    }
  } catch (err) {
    if (err instanceof ConfigPathError) {
      throw err;
    }
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : null;
    if (code === 'ENOENT') {
      return;
    }
    throw new ConfigPathError(`Cannot verify ${label} path`);
  }
}
