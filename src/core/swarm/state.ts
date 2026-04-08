import type { SwarmPhase } from './types.js';

export const CONSENSUS_MAX_ROUNDS = 0;

export const OUTER_LOOP_MAX_ITERATIONS = 0;

export const SWARM_ACTIVE_STATES: readonly SwarmPhase[] = [];

export const SWARM_TERMINAL_STATES: readonly SwarmPhase[] = [];

export const SWARM_RESUMABLE_STATES: readonly SwarmPhase[] = [];

export const SWARM_VALID_TRANSITIONS: Record<SwarmPhase, readonly SwarmPhase[]> = {
  created: [],
  starting: [],
  investigating: [],
  architecting: [],
  planning: [],
  'architect-reviewing': [],
  'fanning-out': [],
  syncing: [],
  merging: [],
  reviewing: [],
  delivering: [],
  completed: [],
  failed: [],
  blocked: [],
  stopped: [],
};

export function isValidSwarmTransition(_from: SwarmPhase, _to: SwarmPhase): boolean {
  return false;
}

export function isSwarmTerminalState(_phase: SwarmPhase): boolean {
  return false;
}

export function isSwarmActiveState(_phase: SwarmPhase): boolean {
  return false;
}

export function canContinueConsensus(_round: number): boolean {
  return false;
}

export function canContinueOuterLoop(_iteration: number): boolean {
  return false;
}
