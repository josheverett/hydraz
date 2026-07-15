import { randomUUID } from 'node:crypto';
import type { CodexRuntimeConfig, ExecutionTarget } from '../config/schema.js';
import type { CodexRolloutVerification } from '../codex/rollout.js';
import {
  type SessionState,
  ACTIVE_STATES,
  TERMINAL_STATES,
  RESUMABLE_STATES,
  VALID_TRANSITIONS,
  isValidTransition as isValidSessionTransition,
  isActiveState as isSessionActiveState,
  isTerminalState as isSessionTerminalState,
} from './state.js';

export type { SessionState };
export { ACTIVE_STATES, TERMINAL_STATES, RESUMABLE_STATES, VALID_TRANSITIONS };

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
  baseBranch?: string;
  executionTarget: ExecutionTarget;
  task: string;
  state: SessionState;
  createdAt: string;
  updatedAt: string;
  workspaceDir?: string;
  blockerMessage?: string;
  failureMessage?: string;
  codex?: {
    remotePid?: number;
    threadId?: string;
    requestedConfig?: CodexRuntimeConfig;
    invocationPath?: string;
    rolloutVerification?: CodexRolloutVerification;
    codexDir?: string;
    eventsPath?: string;
    stderrPath?: string;
    finalPath?: string;
    resultPath?: string;
    runnerOutPath?: string;
    runnerErrPath?: string;
    exitCode?: number | null;
    delivery?: unknown;
  };
}

const SAFE_SESSION_ID = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSessionId(id: string): boolean {
  return SAFE_SESSION_ID.test(id) && id.length <= 128;
}

export function createSession(params: {
  name: string;
  repoRoot: string;
  branchName: string;
  baseBranch?: string;
  executionTarget: ExecutionTarget;
  task: string;
}): SessionMetadata {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: params.name,
    repoRoot: params.repoRoot,
    branchName: params.branchName,
    baseBranch: params.baseBranch,
    executionTarget: params.executionTarget,
    task: params.task,
    state: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

export function isValidTransition(from: SessionState, to: SessionState): boolean {
  return isValidSessionTransition(from, to);
}

export function isActiveState(state: SessionState): boolean {
  return isSessionActiveState(state);
}

export function isTerminalState(state: SessionState): boolean {
  return isSessionTerminalState(state);
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}
