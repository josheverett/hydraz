import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import type { TaskLedger, OwnershipMap } from './types.js';
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
  repoRoot: string;
  sessionId: string;
  task: string;
  sessionName: string;
  workingDirectory: string;
  config: HydrazConfig;
  investigationBrief: string;
  architectureDesign: string;
  workerCount: number;
}

export async function runPlanner(options: PlannerOptions): Promise<PlannerResult> {
  const prompt = buildPlannerPrompt(
    options.task,
    options.sessionName,
    options.investigationBrief,
    options.architectureDesign,
    options.workerCount,
  );

  const executor = launchClaude({
    workingDirectory: options.workingDirectory,
    prompt,
    config: options.config,
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

  const ledger = readTaskLedger(options.repoRoot, options.sessionId);
  if (!ledger) {
    return {
      success: false,
      executorResult,
      ledger: null,
      ownership: null,
      error: 'Planner completed but did not produce swarm/task-ledger.json',
    };
  }

  const ownership = readOwnershipMap(options.repoRoot, options.sessionId);
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
