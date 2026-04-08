import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import type { TaskLedger, OwnershipMap } from './types.js';
import { readWorkerBrief } from './artifacts.js';
import { createWorktree } from '../providers/worktree.js';
import { buildWorkerPrompt } from './prompts/worker.js';

export interface WorkerResult {
  workerId: string;
  success: boolean;
  executorResult: ExecutorResult | null;
  error?: string;
}

export interface FanoutResult {
  success: boolean;
  workerResults: WorkerResult[];
  error?: string;
}

export interface FanoutOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: HydrazConfig;
  ledger: TaskLedger;
  ownership: OwnershipMap;
  planContent: string;
  swarmDir?: string;
  existingWorktrees?: Record<string, string>;
}

async function runSingleWorker(
  workerId: string,
  options: FanoutOptions,
): Promise<WorkerResult> {
  const workerInfo = options.ledger.workers[workerId];
  if (!workerInfo) {
    return { workerId, success: false, executorResult: null, error: `Worker ${workerId} not found in ledger` };
  }

  const brief = readWorkerBrief(options.repoRoot, options.sessionId, workerId);
  if (!brief) {
    return { workerId, success: false, executorResult: null, error: `No brief found for ${workerId}` };
  }

  const worktree = createWorktree(options.repoRoot, `${options.sessionId}-${workerId}`, workerInfo.branch);

  const prompt = buildWorkerPrompt(
    options.task,
    options.sessionName,
    brief,
    options.planContent,
    workerId,
    options.swarmDir,
  );

  const executor = launchClaude({
    workingDirectory: worktree.directory,
    prompt,
    config: options.config,
  });

  const executorResult = await executor.waitForExit();

  return {
    workerId,
    success: executorResult.success,
    executorResult,
    error: executorResult.success ? undefined : `Worker ${workerId} failed: exit code ${executorResult.exitCode}`,
  };
}

export async function runWorkerFanout(options: FanoutOptions): Promise<FanoutResult> {
  const workerIds = Object.keys(options.ledger.workers);

  const workerPromises = workerIds.map(workerId => runSingleWorker(workerId, options));
  const workerResults = await Promise.all(workerPromises);

  const allSucceeded = workerResults.every(r => r.success);

  return {
    success: allSucceeded,
    workerResults,
    error: allSucceeded ? undefined : 'One or more workers failed',
  };
}
