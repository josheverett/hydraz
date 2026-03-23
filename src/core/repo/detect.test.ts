import { describe, it, expect } from 'vitest';
import { detectRepo } from './detect.js';

describe('detectRepo', () => {
  it('detects the current repo from the repo root', () => {
    const result = detectRepo();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('hydraz');
    expect(result!.root).toContain('hydraz');
  });

  it('detects the repo from a subdirectory', () => {
    const result = detectRepo(process.cwd() + '/src');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('hydraz');
  });

  it('returns null for the filesystem root', () => {
    const result = detectRepo('/');
    expect(result).toBeNull();
  });

  it('returns the directory name as the repo name', () => {
    const result = detectRepo();
    expect(result!.name).toBe('hydraz');
  });
});
