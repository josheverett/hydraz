import { spawn, type ChildProcess } from 'node:child_process';
import type { AssembledPrompt } from '../prompts/builder.js';
import type { HydrazConfig } from '../config/schema.js';
import { prepareClaudeEnv } from '../providers/auth.js';
import { parseStreamLine, type ParsedClaudeEvent } from './stream-parser.js';

export interface ExecutorOptions {
  workingDirectory: string;
  prompt: AssembledPrompt;
  config: HydrazConfig;
  onStreamEvent?: (event: ParsedClaudeEvent) => void;
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
  cost?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  turns?: number;
}

export function buildClaudeArgs(prompt: AssembledPrompt): string[] {
  return [
    '--print',
    '--output-format', 'stream-json',
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

  child.stdin?.end();

  let lastResult: ParsedClaudeEvent | null = null;
  let buffer = '';
  let spawnError: Error | null = null;

  child.on('error', (err) => {
    spawnError = err;
    options.onStreamEvent?.({
      kind: 'error',
      timestamp: new Date().toISOString(),
      error: `Failed to spawn claude: ${err.message}`,
      raw: { type: 'result' },
    });
  });

  if (child.stdout) {
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (event) {
          if (event.kind === 'complete' || event.kind === 'error') {
            lastResult = event;
            setTimeout(() => {
              if (!child.killed) child.kill('SIGTERM');
            }, 1000);
          }
          options.onStreamEvent?.(event);
        }
      }
    });
  }

  const waitForExit = (): Promise<ExecutorResult> => {
    return new Promise((resolve) => {
      child.on('close', (code, signal) => {
        if (buffer.trim().length > 0) {
          const event = parseStreamLine(buffer);
          if (event) {
            if (event.kind === 'complete' || event.kind === 'error') {
              lastResult = event;
            }
            options.onStreamEvent?.(event);
          }
        }

        const result: ExecutorResult = {
          exitCode: code,
          signal: signal?.toString() ?? null,
          success: code === 0,
          cost: lastResult?.cost,
          durationMs: lastResult?.durationMs,
          inputTokens: lastResult?.inputTokens,
          outputTokens: lastResult?.outputTokens,
          turns: lastResult?.turns,
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
