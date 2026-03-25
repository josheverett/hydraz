import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export const AUTH_FILE_NAME = '.hydraz-auth';

export function writeAuthFile(worktreeDir: string, env: Record<string, string>): void {
  if (Object.keys(env).length === 0) return;

  const filePath = join(worktreeDir, AUTH_FILE_NAME);
  const content = Object.entries(env)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');

  writeFileSync(filePath, content);
  chmodSync(filePath, 0o600);
}
