import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { TaskLedger, OwnershipMap, ExecutionContext } from './types.js';
import { readTaskLedger, readOwnershipMap } from './artifacts.js';
import { buildPlannerPrompt } from './prompts/planner.js';

export interface PlannerResult {
  success: boolean;
  executorResult: ExecutorResult | null;
  ledger: TaskLedger | null;
  ownership: OwnershipMap | null;
  error?: string;
}

export interface PlannerOptions {
  investigationBrief: string;
  architectureDesign: string;
  workerCount: number;
}

export async function runPlanner(ctx: ExecutionContext, opts: PlannerOptions): Promise<PlannerResult> {
  const prompt = buildPlannerPrompt(
    ctx.task,
    ctx.sessionName,
    opts.investigationBrief,
    opts.architectureDesign,
    opts.workerCount,
    ctx.swarmDir,
  );

  const executor = launchClaude({
    workingDirectory: ctx.workingDirectory,
    prompt,
    config: ctx.config,
  });

  const executorResult = await executor.waitForExit();

  if (!executorResult.success) {
    return {
      success: false,
      executorResult,
      ledger: null,
      ownership: null,
      error: `Planner Claude process failed: exit code ${executorResult.exitCode}`,
    };
  }

  const ledger = readTaskLedger(ctx.repoRoot, ctx.sessionId);
  if (!ledger) {
    return {
      success: false,
      executorResult,
      ledger: null,
      ownership: null,
      error: 'Planner completed but did not produce swarm/task-ledger.json',
    };
  }

  const ownership = readOwnershipMap(ctx.repoRoot, ctx.sessionId);
  if (!ownership) {
    return {
      success: false,
      executorResult,
      ledger,
      ownership: null,
      error: 'Planner completed but did not produce swarm/ownership.json',
    };
  }

  return {
    success: true,
    executorResult,
    ledger,
    ownership,
  };
}
