import { describe, it, expect } from 'vitest';
import { determineResumePoint } from './resume.js';
import type { TaskLedger } from './types.js';

function makeLedger(overrides: Partial<TaskLedger> = {}): TaskLedger {
  return {
    swarmPhase: 'investigating',
    baseCommit: 'abc123',
    outerLoop: 0,
    consensusRound: 0,
    tasks: [],
    workers: {},
    stages: {},
    ...overrides,
  };
}

describe('determineResumePoint', () => {
  it('should resume from start when no ledger exists', () => {
    const result = determineResumePoint(null, false, false, false);
    expect(result.phase).toBe('investigating');
  });

  it('should resume at architecting when investigation brief exists but no design', () => {
    const result = determineResumePoint(
      makeLedger({ swarmPhase: 'investigating' }),
      true,
      false,
      false,
    );
    expect(result.phase).toBe('architecting');
  });

  it('should resume at planning when architecture exists but no plan', () => {
    const result = determineResumePoint(
      makeLedger({ swarmPhase: 'architecting' }),
      true,
      true,
      false,
    );
    expect(result.phase).toBe('planning');
  });

  it('should resume at fanning-out when plan exists and was approved', () => {
    const result = determineResumePoint(
      makeLedger({
        swarmPhase: 'fanning-out',
        tasks: [{ id: 't1', title: 'Task', description: 'Do it', assignedWorker: 'worker-a', ownedPaths: ['src/'], acceptanceCriteria: ['works'], interfaceContracts: [], status: 'pending' }],
        workers: { 'worker-a': { branch: 'hydraz/test-worker-a', status: 'pending' } },
      }),
      true,
      true,
      true,
    );
    expect(result.phase).toBe('fanning-out');
  });

  it('should resume at fanning-out when some workers completed and some failed', () => {
    const result = determineResumePoint(
      makeLedger({
        swarmPhase: 'syncing',
        workers: {
          'worker-a': { branch: 'hydraz/test-worker-a', status: 'completed' },
          'worker-b': { branch: 'hydraz/test-worker-b', status: 'failed' },
        },
      }),
      true,
      true,
      true,
    );
    expect(result.phase).toBe('fanning-out');
  });

  it('should resume at merging when all workers completed', () => {
    const result = determineResumePoint(
      makeLedger({
        swarmPhase: 'syncing',
        workers: {
          'worker-a': { branch: 'hydraz/test-worker-a', status: 'completed' },
          'worker-b': { branch: 'hydraz/test-worker-b', status: 'completed' },
        },
      }),
      true,
      true,
      true,
    );
    expect(result.phase).toBe('merging');
  });

  it('should resume at reviewing when ledger phase is merging and merge completed', () => {
    const result = determineResumePoint(
      makeLedger({
        swarmPhase: 'reviewing',
      }),
      true,
      true,
      true,
    );
    expect(result.phase).toBe('reviewing');
  });

  it('should include a reason for the resume decision', () => {
    const result = determineResumePoint(null, false, false, false);
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe('string');
  });
});
