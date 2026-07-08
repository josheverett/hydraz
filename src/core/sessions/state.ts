export type SessionState =
  | 'created'
  | 'starting'
  | 'syncing'
  | 'delivering'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'stopped';

export const ACTIVE_STATES: readonly SessionState[] = [
  'created',
  'starting',
  'syncing',
  'delivering',
];

export const TERMINAL_STATES: readonly SessionState[] = [
  'completed',
  'failed',
  'blocked',
  'stopped',
];

export const RESUMABLE_STATES: readonly SessionState[] = [
  'stopped',
  'blocked',
  'failed',
];

export const VALID_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  created: ['starting', 'failed', 'blocked', 'stopped'],
  starting: ['syncing', 'failed', 'blocked', 'stopped'],
  syncing: ['delivering', 'completed', 'failed', 'blocked', 'stopped'],
  delivering: ['completed', 'failed', 'blocked', 'stopped'],
  completed: [],
  failed: ['created'],
  blocked: ['created'],
  stopped: ['created'],
};

export function isValidTransition(from: SessionState, to: SessionState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function isTerminalState(state: SessionState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export function isActiveState(state: SessionState): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(state);
}
