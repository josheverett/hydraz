import type { SwarmPhase, TaskLedger } from './types.js';

export interface ResumePoint {
  phase: SwarmPhase;
  reason: string;
}

export function determineResumePoint(
  ledger: TaskLedger | null,
  hasInvestigationBrief: boolean,
  hasArchitectureDesign: boolean,
  hasPlan: boolean,
): ResumePoint {
  if (!ledger) {
    return {
      phase: 'investigating',
      reason: 'No task ledger found; starting from investigation',
    };
  }

  if (!hasInvestigationBrief) {
    return {
      phase: 'investigating',
      reason: 'Investigation brief not found; re-running investigation',
    };
  }

  if (!hasArchitectureDesign) {
    return {
      phase: 'architecting',
      reason: 'Architecture design not found; resuming at architect stage',
    };
  }

  if (!hasPlan) {
    return {
      phase: 'planning',
      reason: 'Plan not found; resuming at planning stage',
    };
  }

  const workers = Object.values(ledger.workers);

  if (workers.length > 0) {
    const hasFailedWorkers = workers.some(w => w.status === 'failed' || w.status === 'stalled');
    const allCompleted = workers.every(w => w.status === 'completed');

    if (hasFailedWorkers) {
      return {
        phase: 'fanning-out',
        reason: 'Some workers failed or stalled; re-launching failed workers',
      };
    }

    if (!allCompleted) {
      return {
        phase: 'fanning-out',
        reason: 'Workers have not all completed; resuming worker fan-out',
      };
    }

    if (allCompleted && ledger.swarmPhase === 'syncing') {
      return {
        phase: 'merging',
        reason: 'All workers completed; resuming at merge stage',
      };
    }
  }

  if (ledger.swarmPhase === 'reviewing') {
    return {
      phase: 'reviewing',
      reason: 'Merge completed; resuming at review stage',
    };
  }

  if (ledger.swarmPhase === 'fanning-out' || ledger.swarmPhase === 'planning' || ledger.swarmPhase === 'architect-reviewing') {
    return {
      phase: 'fanning-out',
      reason: 'Plan was approved; resuming at worker fan-out',
    };
  }

  return {
    phase: 'investigating',
    reason: `Unknown resume state (ledger phase: ${ledger.swarmPhase}); starting from investigation`,
  };
}
