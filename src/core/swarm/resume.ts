import type { SwarmPhase, TaskLedger } from './types.js';

export interface ResumePoint {
  phase: SwarmPhase;
  reason: string;
}

export function determineResumePoint(
  _ledger: TaskLedger | null,
  _hasInvestigationBrief: boolean,
  _hasArchitectureDesign: boolean,
  _hasPlan: boolean,
): ResumePoint {
  return {
    phase: 'created',
    reason: 'not implemented',
  };
}
