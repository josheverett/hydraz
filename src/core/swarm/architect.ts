import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { ExecutionContext } from './types.js';
import { readArchitectureDesign, getSwarmDir } from './artifacts.js';
import { buildArchitectPrompt } from './prompts/architect.js';

export interface ArchitectResult {
  success: boolean;
  designPath: string | null;
  executorResult: ExecutorResult | null;
  error?: string;
}

export interface ArchitectOptions {
  investigationBrief: string;
}

export async function runArchitect(ctx: ExecutionContext, opts: ArchitectOptions): Promise<ArchitectResult> {
  const prompt = buildArchitectPrompt(ctx.task, ctx.sessionName, opts.investigationBrief, ctx.swarmDir);

  const executor = launchClaude({
    workingDirectory: ctx.workingDirectory,
    prompt,
    config: ctx.config,
    containerContext: ctx.containerContext,
  });

  const executorResult = await executor.waitForExit();

  if (!executorResult.success) {
    return {
      success: false,
      designPath: null,
      executorResult,
      error: `Architect Claude process failed: exit code ${executorResult.exitCode}`,
    };
  }

  const design = readArchitectureDesign(ctx.repoRoot, ctx.sessionId);
  if (!design) {
    return {
      success: false,
      designPath: null,
      executorResult,
      error: 'Architect completed but did not produce swarm/architecture/design.md',
    };
  }

  const designPath = `${getSwarmDir(ctx.repoRoot, ctx.sessionId)}/architecture/design.md`;

  return {
    success: true,
    designPath,
    executorResult,
  };
}
