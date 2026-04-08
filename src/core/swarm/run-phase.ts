import type { ExecutorResult } from '../claude/executor.js';
import type { ExecutionContext } from './types.js';

export interface PhaseResult {
  success: boolean;
  executorResult: ExecutorResult;
}

export async function runClaudePhase(
  _ctx: ExecutionContext,
  _prompt: string,
  _workingDirectoryOverride?: string,
): Promise<PhaseResult> {
  return {
    success: false,
    executorResult: { exitCode: 1, signal: null, success: false },
  };
}
