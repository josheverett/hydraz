import type { ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import type { TaskLedger, OwnershipMap } from './types.js';

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

export async function runPlanner(_options: PlannerOptions): Promise<PlannerResult> {
  return {
    success: false,
    executorResult: null,
    ledger: null,
    ownership: null,
    error: 'not implemented',
  };
}
