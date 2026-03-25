import { existsSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { shellEscape } from '../claude/ssh.js';

export const AUTH_FILE_NAME = '.hydraz-auth';

export function writeAuthFile(worktreeDir: string, env: Record<string, string>): void {
  if (Object.keys(env).length === 0) return;

  const filePath = join(worktreeDir, AUTH_FILE_NAME);
  const content = Object.entries(env)
    .map(([key, value]) => `${key}=${shellEscape(value)}\n`)
    .join('');

  writeFileSync(filePath, content);
  chmodSync(filePath, 0o600);
}

export function cleanupAuthFile(worktreeDir: string): void {
  const filePath = join(worktreeDir, AUTH_FILE_NAME);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
