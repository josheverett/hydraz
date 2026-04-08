import type { TaskLedger, OwnershipMap } from './types.js';

export function getSwarmDir(_repoRoot: string, _sessionId: string): string {
  return '';
}

export function ensureSwarmDirs(_repoRoot: string, _sessionId: string): void {}

export function writeTaskLedger(_repoRoot: string, _sessionId: string, _ledger: TaskLedger): void {}

export function readTaskLedger(_repoRoot: string, _sessionId: string): TaskLedger | null {
  return null;
}

export function validateTaskLedger(_data: unknown): TaskLedger {
  throw new Error('not implemented');
}

export function writeOwnershipMap(_repoRoot: string, _sessionId: string, _map: OwnershipMap): void {}

export function readOwnershipMap(_repoRoot: string, _sessionId: string): OwnershipMap | null {
  return null;
}

export function validateOwnershipMap(_data: unknown): OwnershipMap {
  throw new Error('not implemented');
}

export function writeWorkerBrief(_repoRoot: string, _sessionId: string, _workerId: string, _content: string): void {}

export function readWorkerBrief(_repoRoot: string, _sessionId: string, _workerId: string): string | null {
  return null;
}

export function writeWorkerProgress(_repoRoot: string, _sessionId: string, _workerId: string, _content: string): void {}

export function readWorkerProgress(_repoRoot: string, _sessionId: string, _workerId: string): string | null {
  return null;
}

export function writeInvestigationBrief(_repoRoot: string, _sessionId: string, _content: string): void {}

export function readInvestigationBrief(_repoRoot: string, _sessionId: string): string | null {
  return null;
}

export function writeArchitectureDesign(_repoRoot: string, _sessionId: string, _content: string): void {}

export function readArchitectureDesign(_repoRoot: string, _sessionId: string): string | null {
  return null;
}

export function writePlan(_repoRoot: string, _sessionId: string, _content: string): void {}

export function readPlan(_repoRoot: string, _sessionId: string): string | null {
  return null;
}
