import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { resolveRepoDataPaths } from '../repo/paths.js';
import { initRepoState, createNewSession } from '../sessions/manager.js';
import {
  getSwarmDir,
  ensureSwarmDirs,
  writeTaskLedger,
  readTaskLedger,
  validateTaskLedger,
  writeOwnershipMap,
  readOwnershipMap,
  validateOwnershipMap,
  writeWorkerBrief,
  readWorkerBrief,
  writeWorkerProgress,
  readWorkerProgress,
  writeInvestigationBrief,
  readInvestigationBrief,
  writeArchitectureDesign,
  readArchitectureDesign,
  writePlan,
  readPlan,
} from './artifacts.js';
import type { TaskLedger, OwnershipMap } from './types.js';

let repoRoot: string;
let sessionId: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-swarm-artifact-test-'));
  initRepoState(repoRoot);
  const session = createNewSession({
    name: 'test-swarm',
    repoRoot,
    branchName: 'hydraz/test-swarm',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'test task',
  });
  sessionId = session.id;
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  const paths = resolveRepoDataPaths(repoRoot);
  rmSync(paths.repoDataDir, { recursive: true, force: true });
});

const MINIMAL_LEDGER: TaskLedger = {
  swarmPhase: 'investigating',
  baseCommit: 'abc123',
  outerLoop: 0,
  consensusRound: 0,
  tasks: [],
  workers: {},
  stages: {},
};

const MINIMAL_OWNERSHIP: OwnershipMap = {
  workers: {
    'worker-a': { paths: ['src/auth/'], exclusive: true },
  },
  shared: ['package.json'],
};

describe('swarm artifacts', () => {
  describe('getSwarmDir', () => {
    it('should return a path under the session directory', () => {
      const dir = getSwarmDir(repoRoot, sessionId);
      expect(dir).toContain(sessionId);
      expect(dir).toMatch(/swarm$/);
    });
  });

  describe('ensureSwarmDirs', () => {
    it('should create the swarm directory structure', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      const swarmDir = getSwarmDir(repoRoot, sessionId);
      expect(existsSync(swarmDir)).toBe(true);
      expect(existsSync(join(swarmDir, 'investigation'))).toBe(true);
      expect(existsSync(join(swarmDir, 'architecture'))).toBe(true);
      expect(existsSync(join(swarmDir, 'architecture', 'feedback'))).toBe(true);
      expect(existsSync(join(swarmDir, 'plan'))).toBe(true);
      expect(existsSync(join(swarmDir, 'plan', 'revisions'))).toBe(true);
      expect(existsSync(join(swarmDir, 'workers'))).toBe(true);
      expect(existsSync(join(swarmDir, 'merge'))).toBe(true);
      expect(existsSync(join(swarmDir, 'reviews'))).toBe(true);
      expect(existsSync(join(swarmDir, 'delivery'))).toBe(true);
    });

    it('should be idempotent', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      ensureSwarmDirs(repoRoot, sessionId);
      const swarmDir = getSwarmDir(repoRoot, sessionId);
      expect(existsSync(swarmDir)).toBe(true);
    });
  });

  describe('task ledger', () => {
    it('should return null when no ledger exists', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      expect(readTaskLedger(repoRoot, sessionId)).toBeNull();
    });

    it('should write and read a ledger round-trip', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writeTaskLedger(repoRoot, sessionId, MINIMAL_LEDGER);
      const result = readTaskLedger(repoRoot, sessionId);
      expect(result).toEqual(MINIMAL_LEDGER);
    });

    it('should write ledger as JSON', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writeTaskLedger(repoRoot, sessionId, MINIMAL_LEDGER);
      const swarmDir = getSwarmDir(repoRoot, sessionId);
      const raw = readFileSync(join(swarmDir, 'task-ledger.json'), 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe('validateTaskLedger', () => {
    it('should accept a valid ledger', () => {
      const result = validateTaskLedger(MINIMAL_LEDGER);
      expect(result.swarmPhase).toBe('investigating');
    });

    it('should reject non-object input', () => {
      expect(() => validateTaskLedger('string')).toThrow();
      expect(() => validateTaskLedger(null)).toThrow();
    });

    it('should reject a ledger missing required fields', () => {
      expect(() => validateTaskLedger({ swarmPhase: 'investigating' })).toThrow();
    });
  });

  describe('ownership map', () => {
    it('should return null when no map exists', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      expect(readOwnershipMap(repoRoot, sessionId)).toBeNull();
    });

    it('should write and read an ownership map round-trip', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writeOwnershipMap(repoRoot, sessionId, MINIMAL_OWNERSHIP);
      const result = readOwnershipMap(repoRoot, sessionId);
      expect(result).toEqual(MINIMAL_OWNERSHIP);
    });
  });

  describe('validateOwnershipMap', () => {
    it('should accept a valid map', () => {
      const result = validateOwnershipMap(MINIMAL_OWNERSHIP);
      expect(result.shared).toEqual(['package.json']);
    });

    it('should reject non-object input', () => {
      expect(() => validateOwnershipMap(42)).toThrow();
      expect(() => validateOwnershipMap(null)).toThrow();
    });

    it('should reject a map missing workers', () => {
      expect(() => validateOwnershipMap({ shared: [] })).toThrow();
    });

    it('should reject a map missing shared', () => {
      expect(() => validateOwnershipMap({ workers: {} })).toThrow();
    });
  });

  describe('worker brief', () => {
    it('should return null when no brief exists', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      expect(readWorkerBrief(repoRoot, sessionId, 'worker-a')).toBeNull();
    });

    it('should write and read a brief round-trip', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writeWorkerBrief(repoRoot, sessionId, 'worker-a', '# Worker A Brief\nDo the thing.');
      const result = readWorkerBrief(repoRoot, sessionId, 'worker-a');
      expect(result).toBe('# Worker A Brief\nDo the thing.');
    });
  });

  describe('worker progress', () => {
    it('should return null when no progress exists', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      expect(readWorkerProgress(repoRoot, sessionId, 'worker-a')).toBeNull();
    });

    it('should write and read progress round-trip', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writeWorkerProgress(repoRoot, sessionId, 'worker-a', '# Progress\nDone.');
      const result = readWorkerProgress(repoRoot, sessionId, 'worker-a');
      expect(result).toBe('# Progress\nDone.');
    });
  });

  describe('investigation brief', () => {
    it('should return null when no brief exists', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      expect(readInvestigationBrief(repoRoot, sessionId)).toBeNull();
    });

    it('should write and read round-trip', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writeInvestigationBrief(repoRoot, sessionId, '# Investigation\nFound stuff.');
      const result = readInvestigationBrief(repoRoot, sessionId);
      expect(result).toBe('# Investigation\nFound stuff.');
    });
  });

  describe('architecture design', () => {
    it('should return null when no design exists', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      expect(readArchitectureDesign(repoRoot, sessionId)).toBeNull();
    });

    it('should write and read round-trip', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writeArchitectureDesign(repoRoot, sessionId, '# Architecture\nUse modules.');
      const result = readArchitectureDesign(repoRoot, sessionId);
      expect(result).toBe('# Architecture\nUse modules.');
    });
  });

  describe('plan', () => {
    it('should return null when no plan exists', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      expect(readPlan(repoRoot, sessionId)).toBeNull();
    });

    it('should write and read round-trip', () => {
      ensureSwarmDirs(repoRoot, sessionId);
      writePlan(repoRoot, sessionId, '# Plan\nStep 1.');
      const result = readPlan(repoRoot, sessionId);
      expect(result).toBe('# Plan\nStep 1.');
    });
  });
});
