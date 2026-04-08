import type { SwarmPhase } from './types.js';
import { DEFAULT_SWARM_CONFIG } from './types.js';

export const CONSENSUS_MAX_ROUNDS = DEFAULT_SWARM_CONFIG.consensusMaxRounds;

export const OUTER_LOOP_MAX_ITERATIONS = DEFAULT_SWARM_CONFIG.outerLoopMaxIterations;

export const SWARM_ACTIVE_STATES: readonly SwarmPhase[] = [
  'created',
  'starting',
  'investigating',
  'architecting',
  'planning',
  'architect-reviewing',
  'fanning-out',
  'syncing',
  'merging',
  'reviewing',
  'delivering',
];

export const SWARM_TERMINAL_STATES: readonly SwarmPhase[] = [
  'completed',
  'failed',
  'blocked',
  'stopped',
];

export const SWARM_RESUMABLE_STATES: readonly SwarmPhase[] = [
  'stopped',
  'blocked',
  'failed',
];

export const SWARM_VALID_TRANSITIONS: Record<SwarmPhase, readonly SwarmPhase[]> = {
  created: ['starting', 'failed', 'blocked', 'stopped'],
  starting: ['investigating', 'failed', 'blocked', 'stopped'],
  investigating: ['architecting', 'failed', 'blocked', 'stopped'],
  architecting: ['planning', 'failed', 'blocked', 'stopped'],
  planning: ['architect-reviewing', 'failed', 'blocked', 'stopped'],
  'architect-reviewing': ['fanning-out', 'planning', 'failed', 'blocked', 'stopped'],
  'fanning-out': ['syncing', 'failed', 'blocked', 'stopped'],
  syncing: ['merging', 'failed', 'blocked', 'stopped'],
  merging: ['reviewing', 'failed', 'blocked', 'stopped'],
  reviewing: ['delivering', 'architecting', 'fanning-out', 'failed', 'blocked', 'stopped'],
  delivering: ['completed', 'failed', 'blocked', 'stopped'],
  completed: [],
  failed: ['created'],
  blocked: ['created'],
  stopped: ['created'],
};

export function isValidSwarmTransition(from: SwarmPhase, to: SwarmPhase): boolean {
  return SWARM_VALID_TRANSITIONS[from].includes(to);
}

export function isSwarmTerminalState(phase: SwarmPhase): boolean {
  return (SWARM_TERMINAL_STATES as readonly string[]).includes(phase);
}

export function isSwarmActiveState(phase: SwarmPhase): boolean {
  return (SWARM_ACTIVE_STATES as readonly string[]).includes(phase);
}

export function canContinueConsensus(round: number): boolean {
  return round < CONSENSUS_MAX_ROUNDS;
}

export function canContinueOuterLoop(iteration: number): boolean {
  return iteration < OUTER_LOOP_MAX_ITERATIONS;
}
