import { describe, it, expect } from 'vitest';
import { artifactPath } from './paths.js';

describe('artifactPath', () => {
  it('should return absolute path when swarmDir is provided', () => {
    const result = artifactPath('/home/user/.hydraz/swarm', 'investigation', 'brief.md');
    expect(result).toBe('/home/user/.hydraz/swarm/investigation/brief.md');
  });

  it('should return relative swarm path when swarmDir is undefined', () => {
    const result = artifactPath(undefined, 'investigation', 'brief.md');
    expect(result).toBe('swarm/investigation/brief.md');
  });

  it('should handle single segment', () => {
    const result = artifactPath('/tmp/swarm', 'task-ledger.json');
    expect(result).toBe('/tmp/swarm/task-ledger.json');
  });

  it('should handle deeply nested segments', () => {
    const result = artifactPath('/tmp/swarm', 'architecture', 'feedback', 'round-1.md');
    expect(result).toBe('/tmp/swarm/architecture/feedback/round-1.md');
  });
});
