import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { TaskLedger, OwnershipMap, ExecutionContext } from './types.js';
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
  ledger: TaskLedger;
  ownership: OwnershipMap;
  planContent: string;
  existingWorktrees?: Record<string, string>;
}

async function runSingleWorker(
  workerId: string,
  ctx: ExecutionContext,
  opts: FanoutOptions,
): Promise<WorkerResult> {
  const workerInfo = opts.ledger.workers[workerId];
  if (!workerInfo) {
    return { workerId, success: false, executorResult: null, error: `Worker ${workerId} not found in ledger` };
  }

  const brief = readWorkerBrief(ctx.repoRoot, ctx.sessionId, workerId);
  if (!brief) {
    return { workerId, success: false, executorResult: null, error: `No brief found for ${workerId}` };
  }

  let workingDirectory: string;
  if (opts.existingWorktrees?.[workerId]) {
    workingDirectory = opts.existingWorktrees[workerId];
  } else {
    const worktree = createWorktree(ctx.repoRoot, `${ctx.sessionId}-${workerId}`, workerInfo.branch);
    workingDirectory = worktree.directory;
  }

  const prompt = buildWorkerPrompt(
    ctx.task,
    ctx.sessionName,
    brief,
    opts.planContent,
    workerId,
    ctx.swarmDir,
  );

  const executor = launchClaude({
    workingDirectory,
    prompt,
    config: ctx.config,
  });

  const executorResult = await executor.waitForExit();

  return {
    workerId,
    success: executorResult.success,
    executorResult,
    error: executorResult.success ? undefined : `Worker ${workerId} failed: exit code ${executorResult.exitCode}`,
  };
}

export async function runWorkerFanout(ctx: ExecutionContext, opts: FanoutOptions): Promise<FanoutResult> {
  const workerIds = Object.keys(opts.ledger.workers);

  const workerPromises = workerIds.map(workerId => runSingleWorker(workerId, ctx, opts));
  const workerResults = await Promise.all(workerPromises);

  const allSucceeded = workerResults.every(r => r.success);

  return {
    success: allSucceeded,
    workerResults,
    error: allSucceeded ? undefined : 'One or more workers failed',
  };
}
