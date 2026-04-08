import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionDir } from '../sessions/manager.js';
import type { TaskLedger, OwnershipMap } from './types.js';

export function getSwarmDir(repoRoot: string, sessionId: string): string {
  return join(getSessionDir(repoRoot, sessionId), 'swarm');
}

export function ensureSwarmDirs(repoRoot: string, sessionId: string): void {
  const swarmDir = getSwarmDir(repoRoot, sessionId);
  const dirs = [
    swarmDir,
    join(swarmDir, 'investigation'),
    join(swarmDir, 'architecture'),
    join(swarmDir, 'architecture', 'feedback'),
    join(swarmDir, 'plan'),
    join(swarmDir, 'plan', 'revisions'),
    join(swarmDir, 'workers'),
    join(swarmDir, 'merge'),
    join(swarmDir, 'reviews'),
    join(swarmDir, 'delivery'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeTaskLedger(repoRoot: string, sessionId: string, ledger: TaskLedger): void {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'task-ledger.json');
  writeFileSync(filePath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
}

export function readTaskLedger(repoRoot: string, sessionId: string): TaskLedger | null {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'task-ledger.json');
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  return validateTaskLedger(JSON.parse(raw));
}

export function validateTaskLedger(data: unknown): TaskLedger {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Task ledger must be a non-null object');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.swarmPhase !== 'string') throw new Error('Task ledger missing swarmPhase');
  if (typeof obj.baseCommit !== 'string') throw new Error('Task ledger missing baseCommit');
  if (typeof obj.outerLoop !== 'number') throw new Error('Task ledger missing outerLoop');
  if (typeof obj.consensusRound !== 'number') throw new Error('Task ledger missing consensusRound');
  if (!Array.isArray(obj.tasks)) throw new Error('Task ledger missing tasks array');
  if (typeof obj.workers !== 'object' || obj.workers === null) throw new Error('Task ledger missing workers object');
  if (typeof obj.stages !== 'object' || obj.stages === null) throw new Error('Task ledger missing stages object');
  return data as TaskLedger;
}

export function writeOwnershipMap(repoRoot: string, sessionId: string, map: OwnershipMap): void {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'ownership.json');
  writeFileSync(filePath, JSON.stringify(map, null, 2), { mode: 0o600 });
}

export function readOwnershipMap(repoRoot: string, sessionId: string): OwnershipMap | null {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'ownership.json');
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  return validateOwnershipMap(JSON.parse(raw));
}

export function validateOwnershipMap(data: unknown): OwnershipMap {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Ownership map must be a non-null object');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.workers !== 'object' || obj.workers === null) throw new Error('Ownership map missing workers');
  if (!Array.isArray(obj.shared)) throw new Error('Ownership map missing shared array');
  return data as OwnershipMap;
}

function ensureWorkerDir(repoRoot: string, sessionId: string, workerId: string): string {
  const dir = join(getSwarmDir(repoRoot, sessionId), 'workers', workerId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeWorkerBrief(repoRoot: string, sessionId: string, workerId: string, content: string): void {
  const dir = ensureWorkerDir(repoRoot, sessionId, workerId);
  writeFileSync(join(dir, 'brief.md'), content, { mode: 0o600 });
}

export function readWorkerBrief(repoRoot: string, sessionId: string, workerId: string): string | null {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'workers', workerId, 'brief.md');
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writeWorkerProgress(repoRoot: string, sessionId: string, workerId: string, content: string): void {
  const dir = ensureWorkerDir(repoRoot, sessionId, workerId);
  writeFileSync(join(dir, 'progress.md'), content, { mode: 0o600 });
}

export function readWorkerProgress(repoRoot: string, sessionId: string, workerId: string): string | null {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'workers', workerId, 'progress.md');
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writeInvestigationBrief(repoRoot: string, sessionId: string, content: string): void {
  writeFileSync(join(getSwarmDir(repoRoot, sessionId), 'investigation', 'brief.md'), content, { mode: 0o600 });
}

export function readInvestigationBrief(repoRoot: string, sessionId: string): string | null {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'investigation', 'brief.md');
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writeArchitectureDesign(repoRoot: string, sessionId: string, content: string): void {
  writeFileSync(join(getSwarmDir(repoRoot, sessionId), 'architecture', 'design.md'), content, { mode: 0o600 });
}

export function readArchitectureDesign(repoRoot: string, sessionId: string): string | null {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'architecture', 'design.md');
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writePlan(repoRoot: string, sessionId: string, content: string): void {
  writeFileSync(join(getSwarmDir(repoRoot, sessionId), 'plan', 'plan.md'), content, { mode: 0o600 });
}

export function readPlan(repoRoot: string, sessionId: string): string | null {
  const filePath = join(getSwarmDir(repoRoot, sessionId), 'plan', 'plan.md');
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}
