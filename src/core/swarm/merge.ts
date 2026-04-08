import type { TaskLedger } from './types.js';

export type MergeOutcome = 'clean' | 'conflict-resolved' | 'conflict-unresolvable';

export interface WorkerMergeResult {
  workerId: string;
  branch: string;
  outcome: MergeOutcome;
  conflictFiles?: string[];
}

export interface FanInResult {
  success: boolean;
  integrationBranch: string;
  workerMerges: WorkerMergeResult[];
  reportPath: string | null;
  error?: string;
}

export interface FanInOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  workingDirectory: string;
  ledger: TaskLedger;
}

export function runFanIn(_options: FanInOptions): FanInResult {
  return {
    success: false,
    integrationBranch: '',
    workerMerges: [],
    reportPath: null,
    error: 'not implemented',
  };
}
