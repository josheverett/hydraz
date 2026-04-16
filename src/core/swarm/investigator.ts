import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { ExecutionContext } from './types.js';
import { readInvestigationBrief, getSwarmDir } from './artifacts.js';
import { buildInvestigatorPrompt } from './prompts/investigator.js';

export interface InvestigationResult {
  success: boolean;
  briefPath: string | null;
  executorResult: ExecutorResult | null;
  error?: string;
}

export async function runInvestigation(ctx: ExecutionContext): Promise<InvestigationResult> {
  const prompt = buildInvestigatorPrompt(ctx.task, ctx.sessionName, ctx.swarmDir, ctx.repoPromptContent);

  const executor = launchClaude({
    workingDirectory: ctx.workingDirectory,
    prompt,
    config: ctx.config,
  });

  const executorResult = await executor.waitForExit();

  if (!executorResult.success) {
    return {
      success: false,
      briefPath: null,
      executorResult,
      error: `Investigator Claude process failed: exit code ${executorResult.exitCode}`,
    };
  }

  const brief = readInvestigationBrief(ctx.repoRoot, ctx.sessionId);
  if (!brief) {
    return {
      success: false,
      briefPath: null,
      executorResult,
      error: 'Investigator completed but did not produce swarm/investigation/brief.md',
    };
  }

  const briefPath = `${getSwarmDir(ctx.repoRoot, ctx.sessionId)}/investigation/brief.md`;

  return {
    success: true,
    briefPath,
    executorResult,
  };
}
