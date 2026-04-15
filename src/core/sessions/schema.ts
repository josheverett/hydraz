import { randomUUID } from 'node:crypto';
import type { ExecutionTarget } from '../config/schema.js';
import type { SwarmPhase } from '../swarm/types.js';
import {
  SWARM_ACTIVE_STATES,
  SWARM_TERMINAL_STATES,
  SWARM_RESUMABLE_STATES,
  SWARM_VALID_TRANSITIONS,
  isValidSwarmTransition,
  isSwarmActiveState,
  isSwarmTerminalState,
} from '../swarm/state.js';

export type SessionState = SwarmPhase;

export const ACTIVE_STATES: readonly SessionState[] = SWARM_ACTIVE_STATES;

export const TERMINAL_STATES: readonly SessionState[] = SWARM_TERMINAL_STATES;

export const VALID_TRANSITIONS: Record<SessionState, readonly SessionState[]> = SWARM_VALID_TRANSITIONS;

export const RESUMABLE_STATES: readonly SessionState[] = SWARM_RESUMABLE_STATES;

export const ARTIFACT_FILES = [
  'intake.md',
  'plan.md',
  'implementation-summary.md',
  'verification-report.md',
  'pr-draft.md',
] as const;

export type ArtifactFile = (typeof ARTIFACT_FILES)[number];

export interface SessionMetadata {
  id: string;
  name: string;
  repoRoot: string;
  branchName: string;
  personas: [string, string, string];
  executionTarget: ExecutionTarget;
  task: string;
  state: SessionState;
  createdAt: string;
  updatedAt: string;
  workspaceDir?: string;
  blockerMessage?: string;
  failureMessage?: string;
}

const SAFE_SESSION_ID = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSessionId(id: string): boolean {
  return SAFE_SESSION_ID.test(id) && id.length <= 128;
}

export function createSession(params: {
  name: string;
  repoRoot: string;
  branchName: string;
  personas: [string, string, string];
  executionTarget: ExecutionTarget;
  task: string;
}): SessionMetadata {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: params.name,
    repoRoot: params.repoRoot,
    branchName: params.branchName,
    personas: [...params.personas],
    executionTarget: params.executionTarget,
    task: params.task,
    state: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

export function isValidTransition(from: SessionState, to: SessionState): boolean {
  return isValidSwarmTransition(from, to);
}

export function isActiveState(state: SessionState): boolean {
  return isSwarmActiveState(state);
}

export function isTerminalState(state: SessionState): boolean {
  return isSwarmTerminalState(state);
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}
