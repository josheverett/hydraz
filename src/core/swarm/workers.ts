import type { ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import type { TaskLedger, OwnershipMap } from './types.js';

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
}

export async function runWorkerFanout(_options: FanoutOptions): Promise<FanoutResult> {
  return {
    success: false,
    workerResults: [],
    error: 'not implemented',
  };
}
