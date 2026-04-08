import type { ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import type { TaskLedger, OwnershipMap } from './types.js';

export interface ConsensusResult {
  success: boolean;
  roundsUsed: number;
  finalLedger: TaskLedger | null;
  finalOwnership: OwnershipMap | null;
  architectFinalSay: boolean;
  error?: string;
}

export interface ConsensusOptions {
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

export async function runConsensus(_options: ConsensusOptions): Promise<ConsensusResult> {
  return {
    success: false,
    roundsUsed: 0,
    finalLedger: null,
    finalOwnership: null,
    architectFinalSay: false,
    error: 'not implemented',
  };
}
