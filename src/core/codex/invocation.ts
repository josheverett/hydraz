import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodexRuntimeConfig } from '../config/schema.js';

export const CODEX_INVOCATION_FILE = 'invocation.json';

export type CodexInvocationSpawnState =
  | 'prepared'
  | 'spawned'
  | 'exited'
  | 'spawn-failed';

export interface CodexInvocationEvidence {
  version: 1;
  mode: 'exec' | 'resume';
  command: string;
  args: string[];
  promptOmitted: true;
  promptArgumentIndex: number;
  requested: CodexRuntimeConfig;
  normalized: {
    fastMode: boolean;
    serviceTier: 'priority' | 'default';
  };
  preparedAt: string;
  spawnedAt?: string;
  exitedAt?: string;
  spawnState: CodexInvocationSpawnState;
  threadId?: string;
  exitCode?: number | null;
}

export interface CodexInvocationRecorder {
  path: string;
  markSpawned(): void;
  markThreadStarted(threadId: string): void;
  markExited(exitCode: number | null): void;
  markSpawnFailed(): void;
  snapshot(): CodexInvocationEvidence;
}

export function createCodexInvocationRecorder(options: {
  codexDir: string;
  mode: 'exec' | 'resume';
  command: { cmd: string; args: string[] };
  prompt: string;
  requested: CodexRuntimeConfig;
  threadId?: string;
}): CodexInvocationRecorder {
  const promptArgumentIndex = options.command.args.length - 1;
  if (options.command.args[promptArgumentIndex] !== options.prompt) {
    throw new Error('Refusing to persist Codex invocation evidence: prompt is not the final argument.');
  }

  const path = join(options.codexDir, CODEX_INVOCATION_FILE);
  const fastMode = options.requested.speed === 'fast';
  const evidence: CodexInvocationEvidence = {
    version: 1,
    mode: options.mode,
    command: options.command.cmd,
    args: options.command.args.slice(0, promptArgumentIndex),
    promptOmitted: true,
    promptArgumentIndex,
    requested: { ...options.requested },
    normalized: {
      fastMode,
      serviceTier: fastMode ? 'priority' : 'default',
    },
    preparedAt: new Date().toISOString(),
    spawnState: 'prepared',
    ...(options.threadId ? { threadId: options.threadId } : {}),
  };

  const persist = (): void => {
    writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  persist();

  return {
    path,
    markSpawned(): void {
      evidence.spawnedAt = new Date().toISOString();
      evidence.spawnState = 'spawned';
      persist();
    },
    markThreadStarted(threadId: string): void {
      evidence.threadId = threadId;
      persist();
    },
    markExited(exitCode: number | null): void {
      evidence.exitedAt = new Date().toISOString();
      evidence.exitCode = exitCode;
      evidence.spawnState = 'exited';
      persist();
    },
    markSpawnFailed(): void {
      evidence.exitedAt = new Date().toISOString();
      evidence.spawnState = 'spawn-failed';
      persist();
    },
    snapshot(): CodexInvocationEvidence {
      return structuredClone(evidence);
    },
  };
}
