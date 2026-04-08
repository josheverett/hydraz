import type { HydrazConfig } from '../config/schema.js';
import type { SwarmPhase } from './types.js';

export interface PipelineCallbacks {
  onPhaseChange?: (phase: SwarmPhase) => void;
  onEvent?: (type: string, message: string) => void;
  onError?: (message: string) => void;
}

export interface PipelineResult {
  success: boolean;
  phase: SwarmPhase;
  outerLoopsUsed: number;
  consensusRoundsUsed: number;
  approved: boolean;
  error?: string;
}

export interface PipelineOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: HydrazConfig;
  workerCount: number;
  reviewerPersonas: Array<{ name: string; persona: string }>;
  maxOuterLoops: number;
  maxConsensusRounds: number;
  callbacks?: PipelineCallbacks;
}

export async function runSwarmPipeline(_options: PipelineOptions): Promise<PipelineResult> {
  return {
    success: false,
    phase: 'created',
    outerLoopsUsed: 0,
    consensusRoundsUsed: 0,
    approved: false,
    error: 'not implemented',
  };
}
