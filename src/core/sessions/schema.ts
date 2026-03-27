import { randomUUID } from 'node:crypto';
import type { ExecutionTarget } from '../config/schema.js';

export type SessionState =
  | 'created'
  | 'starting'
  | 'planning'
  | 'implementing'
  | 'verifying'
  | 'completed'
  | 'blocked'
  | 'stopped'
  | 'failed';

export const ACTIVE_STATES: readonly SessionState[] = [
  'created',
  'starting',
  'planning',
  'implementing',
  'verifying',
];

export const TERMINAL_STATES: readonly SessionState[] = [
  'completed',
  'blocked',
  'stopped',
  'failed',
];

export const VALID_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  created: ['starting', 'stopped'],
  starting: ['planning', 'blocked', 'stopped', 'failed'],
  planning: ['implementing', 'completed', 'blocked', 'stopped', 'failed'],
  implementing: ['verifying', 'completed', 'blocked', 'stopped', 'failed'],
  verifying: ['completed', 'implementing', 'blocked', 'stopped', 'failed'],
  completed: [],
  blocked: ['created'],
  stopped: ['created'],
  failed: ['created'],
};

export const RESUMABLE_STATES: readonly SessionState[] = ['stopped', 'blocked', 'failed'];

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
  return VALID_TRANSITIONS[from].includes(to);
}

export function isActiveState(state: SessionState): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(state);
}

export function isTerminalState(state: SessionState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}
