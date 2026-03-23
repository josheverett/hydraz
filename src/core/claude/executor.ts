import { spawn, type ChildProcess } from 'node:child_process';
import type { AssembledPrompt } from '../prompts/builder.js';
import type { HydrazConfig } from '../config/schema.js';
import { prepareClaudeEnv } from '../providers/auth.js';

export interface ExecutorOptions {
  workingDirectory: string;
  prompt: AssembledPrompt;
  config: HydrazConfig;
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  onExit?: (code: number | null) => void;
}

export interface ExecutorHandle {
  process: ChildProcess;
  pid: number | undefined;
  kill: () => void;
  waitForExit: () => Promise<ExecutorResult>;
}

export interface ExecutorResult {
  exitCode: number | null;
  signal: string | null;
  success: boolean;
}

export function buildClaudeArgs(prompt: AssembledPrompt): string[] {
  return [
    '--print',
    '--output-format', 'text',
    '--verbose',
    prompt.fullText,
  ];
}

export function buildClaudeEnv(
  config: HydrazConfig,
  workingDirectory: string,
): Record<string, string> {
  const claudeEnv = prepareClaudeEnv(config);
  return {
    ...process.env as Record<string, string>,
    ...claudeEnv,
    HYDRAZ_SESSION: 'true',
    HYDRAZ_WORKSPACE: workingDirectory,
  };
}

export function launchClaude(options: ExecutorOptions): ExecutorHandle {
  const args = buildClaudeArgs(options.prompt);
  const env = buildClaudeEnv(options.config, options.workingDirectory);

  const child = spawn('claude', args, {
    cwd: options.workingDirectory,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (child.stdout) {
    child.stdout.on('data', (data: Buffer) => {
      options.onOutput?.(data.toString());
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (data: Buffer) => {
      options.onError?.(data.toString());
    });
  }

  const waitForExit = (): Promise<ExecutorResult> => {
    return new Promise((resolve) => {
      child.on('close', (code, signal) => {
        const result: ExecutorResult = {
          exitCode: code,
          signal: signal?.toString() ?? null,
          success: code === 0,
        };
        options.onExit?.(code);
        resolve(result);
      });
    });
  };

  return {
    process: child,
    pid: child.pid,
    kill: () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },
    waitForExit,
  };
}

export function mapExitToSessionState(result: ExecutorResult): {
  state: 'completed' | 'failed';
  message?: string;
} {
  if (result.success) {
    return { state: 'completed' };
  }

  if (result.signal) {
    return {
      state: 'failed',
      message: `Claude Code process killed by signal: ${result.signal}`,
    };
  }

  return {
    state: 'failed',
    message: `Claude Code process exited with code ${result.exitCode}`,
  };
}
