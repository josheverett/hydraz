import {
  chmodSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { CodexRunnerOptions } from './runner.js';

export const RUNNER_OPTIONS_FILENAME = 'runner-options.json';
export const RUNNER_OPTIONS_FILE_ENV = 'HYDRAZ_CODEX_RUNNER_OPTIONS_FILE';

export function writeRunnerOptionsFile(
  directory: string,
  options: CodexRunnerOptions,
): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = join(directory, RUNNER_OPTIONS_FILENAME);
  writeFileSync(path, JSON.stringify(options), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function loadRunnerOptionsFile(
  environment: NodeJS.ProcessEnv = process.env,
): CodexRunnerOptions {
  const path = environment[RUNNER_OPTIONS_FILE_ENV];
  if (!path) {
    throw new Error('Missing runner options file.');
  }

  let serialized: string;
  try {
    serialized = readFileSync(path, 'utf8');
  } catch {
    throw new Error('Failed to load runner options.');
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Best-effort cleanup when the file could not be read or was already removed.
    }
  }

  try {
    return JSON.parse(serialized) as CodexRunnerOptions;
  } catch {
    throw new Error('Failed to load runner options.');
  }
}
