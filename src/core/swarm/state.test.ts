import { describe, it, expect } from 'vitest';
import {
  SWARM_VALID_TRANSITIONS,
  SWARM_TERMINAL_STATES,
  SWARM_ACTIVE_STATES,
  SWARM_RESUMABLE_STATES,
  isValidSwarmTransition,
  isSwarmTerminalState,
  isSwarmActiveState,
  CONSENSUS_MAX_ROUNDS,
  OUTER_LOOP_MAX_ITERATIONS,
  canContinueConsensus,
  canContinueOuterLoop,
} from './state.js';
import type { SwarmPhase } from './types.js';

describe('swarm state machine', () => {
  describe('SWARM_VALID_TRANSITIONS', () => {
    it('should define transitions for every SwarmPhase', () => {
      const allPhases: SwarmPhase[] = [
        'created', 'starting', 'investigating', 'architecting',
        'planning', 'architect-reviewing', 'fanning-out', 'syncing',
        'merging', 'reviewing', 'delivering', 'completed',
        'failed', 'blocked', 'stopped',
      ];
      for (const phase of allPhases) {
        expect(SWARM_VALID_TRANSITIONS).toHaveProperty(phase);
      }
    });

    it('should have no outgoing transitions from completed', () => {
      expect(SWARM_VALID_TRANSITIONS['completed']).toEqual([]);
    });
  });

  describe('happy path transitions', () => {
    const happyPath: [SwarmPhase, SwarmPhase][] = [
      ['created', 'starting'],
      ['starting', 'investigating'],
      ['investigating', 'architecting'],
      ['architecting', 'planning'],
      ['planning', 'architect-reviewing'],
      ['architect-reviewing', 'fanning-out'],
      ['fanning-out', 'syncing'],
      ['syncing', 'merging'],
      ['merging', 'reviewing'],
      ['reviewing', 'delivering'],
      ['delivering', 'completed'],
    ];

    for (const [from, to] of happyPath) {
      it(`should allow ${from} -> ${to}`, () => {
        expect(isValidSwarmTransition(from, to)).toBe(true);
      });
    }
  });

  describe('consensus loop transitions', () => {
    it('should allow architect-reviewing -> planning (feedback loop)', () => {
      expect(isValidSwarmTransition('architect-reviewing', 'planning')).toBe(true);
    });
  });

  describe('outer loop transitions', () => {
    it('should allow reviewing -> architecting (architectural feedback)', () => {
      expect(isValidSwarmTransition('reviewing', 'architecting')).toBe(true);
    });

    it('should allow reviewing -> fanning-out (implementation feedback)', () => {
      expect(isValidSwarmTransition('reviewing', 'fanning-out')).toBe(true);
    });
  });

  describe('terminal transitions', () => {
    const nonTerminalPhases: SwarmPhase[] = [
      'created', 'starting', 'investigating', 'architecting',
      'planning', 'architect-reviewing', 'fanning-out', 'syncing',
      'merging', 'reviewing', 'delivering',
    ];

    for (const phase of nonTerminalPhases) {
      it(`should allow ${phase} -> failed`, () => {
        expect(isValidSwarmTransition(phase, 'failed')).toBe(true);
      });

      it(`should allow ${phase} -> blocked`, () => {
        expect(isValidSwarmTransition(phase, 'blocked')).toBe(true);
      });

      it(`should allow ${phase} -> stopped`, () => {
        expect(isValidSwarmTransition(phase, 'stopped')).toBe(true);
      });
    }
  });

  describe('resume transitions', () => {
    for (const state of ['stopped', 'blocked', 'failed'] as SwarmPhase[]) {
      it(`should allow ${state} -> created (resume)`, () => {
        expect(isValidSwarmTransition(state, 'created')).toBe(true);
      });
    }
  });

  describe('invalid transitions', () => {
    it('should reject investigating -> fanning-out (skipping stages)', () => {
      expect(isValidSwarmTransition('investigating', 'fanning-out')).toBe(false);
    });

    it('should reject completed -> anything', () => {
      expect(isValidSwarmTransition('completed', 'created')).toBe(false);
      expect(isValidSwarmTransition('completed', 'starting')).toBe(false);
    });

    it('should reject merging -> planning (not a valid loop-back)', () => {
      expect(isValidSwarmTransition('merging', 'planning')).toBe(false);
    });
  });

  describe('state classification', () => {
    it('should classify completed, failed, blocked, stopped as terminal', () => {
      expect(isSwarmTerminalState('completed')).toBe(true);
      expect(isSwarmTerminalState('failed')).toBe(true);
      expect(isSwarmTerminalState('blocked')).toBe(true);
      expect(isSwarmTerminalState('stopped')).toBe(true);
    });

    it('should not classify active phases as terminal', () => {
      expect(isSwarmTerminalState('investigating')).toBe(false);
      expect(isSwarmTerminalState('planning')).toBe(false);
      expect(isSwarmTerminalState('syncing')).toBe(false);
    });

    it('should classify pipeline phases as active', () => {
      expect(isSwarmActiveState('created')).toBe(true);
      expect(isSwarmActiveState('investigating')).toBe(true);
      expect(isSwarmActiveState('planning')).toBe(true);
      expect(isSwarmActiveState('fanning-out')).toBe(true);
      expect(isSwarmActiveState('reviewing')).toBe(true);
      expect(isSwarmActiveState('delivering')).toBe(true);
    });

    it('should not classify terminal states as active', () => {
      expect(isSwarmActiveState('completed')).toBe(false);
      expect(isSwarmActiveState('failed')).toBe(false);
    });

    it('should list stopped, blocked, failed as resumable', () => {
      expect(SWARM_RESUMABLE_STATES).toContain('stopped');
      expect(SWARM_RESUMABLE_STATES).toContain('blocked');
      expect(SWARM_RESUMABLE_STATES).toContain('failed');
      expect(SWARM_RESUMABLE_STATES).not.toContain('completed');
    });
  });

  describe('bounds checking', () => {
    it('should define consensus max rounds as 10', () => {
      expect(CONSENSUS_MAX_ROUNDS).toBe(10);
    });

    it('should define outer loop max iterations as 5', () => {
      expect(OUTER_LOOP_MAX_ITERATIONS).toBe(5);
    });

    it('should allow consensus to continue below the limit', () => {
      expect(canContinueConsensus(0)).toBe(true);
      expect(canContinueConsensus(5)).toBe(true);
      expect(canContinueConsensus(9)).toBe(true);
    });

    it('should reject consensus at or above the limit', () => {
      expect(canContinueConsensus(10)).toBe(false);
      expect(canContinueConsensus(11)).toBe(false);
    });

    it('should allow outer loop to continue below the limit', () => {
      expect(canContinueOuterLoop(0)).toBe(true);
      expect(canContinueOuterLoop(4)).toBe(true);
    });

    it('should reject outer loop at or above the limit', () => {
      expect(canContinueOuterLoop(5)).toBe(false);
      expect(canContinueOuterLoop(6)).toBe(false);
    });
  });
});
