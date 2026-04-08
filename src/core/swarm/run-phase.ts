import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { ExecutionContext } from './types.js';

export interface PhaseResult {
  success: boolean;
  executorResult: ExecutorResult;
}

export async function runClaudePhase(
  ctx: ExecutionContext,
  prompt: string,
  workingDirectoryOverride?: string,
): Promise<PhaseResult> {
  const executor = launchClaude({
    workingDirectory: workingDirectoryOverride ?? ctx.workingDirectory,
    prompt,
    config: ctx.config,
    containerContext: ctx.containerContext,
  });

  const executorResult = await executor.waitForExit();

  return {
    success: executorResult.success,
    executorResult,
  };
}
