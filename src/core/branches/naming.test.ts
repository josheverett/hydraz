import { describe, it, expect } from 'vitest';
import { suggestBranchName, isValidBranchName, isValidSessionName } from './naming.js';

describe('suggestBranchName', () => {
  it('prefixes with hydraz/ by default', () => {
    expect(suggestBranchName('fix-auth')).toBe('hydraz/fix-auth');
  });

  it('uses a custom prefix', () => {
    expect(suggestBranchName('fix-auth', 'feature/')).toBe('feature/fix-auth');
  });
});

describe('isValidBranchName', () => {
  it('accepts valid branch names', () => {
    expect(isValidBranchName('hydraz/fix-auth')).toBe(true);
    expect(isValidBranchName('feature/my-branch')).toBe(true);
    expect(isValidBranchName('simple')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidBranchName('')).toBe(false);
  });

  it('rejects names with spaces', () => {
    expect(isValidBranchName('my branch')).toBe(false);
  });

  it('rejects names with ..', () => {
    expect(isValidBranchName('a..b')).toBe(false);
  });

  it('rejects names ending with .', () => {
    expect(isValidBranchName('branch.')).toBe(false);
  });

  it('rejects names with ~', () => {
    expect(isValidBranchName('branch~1')).toBe(false);
  });

  it('rejects names with ^', () => {
    expect(isValidBranchName('branch^2')).toBe(false);
  });

  it('rejects names with @{', () => {
    expect(isValidBranchName('branch@{0}')).toBe(false);
  });
});

describe('isValidSessionName', () => {
  it('accepts valid session names', () => {
    expect(isValidSessionName('fix-auth-timeout')).toBe(true);
    expect(isValidSessionName('eng-482')).toBe(true);
    expect(isValidSessionName('ab')).toBe(true);
  });

  it('rejects single character', () => {
    expect(isValidSessionName('a')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidSessionName('FixAuth')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidSessionName('fix auth')).toBe(false);
  });

  it('rejects leading hyphen', () => {
    expect(isValidSessionName('-fix')).toBe(false);
  });

  it('rejects trailing hyphen', () => {
    expect(isValidSessionName('fix-')).toBe(false);
  });

  it('rejects names over 64 characters', () => {
    expect(isValidSessionName('a'.repeat(65))).toBe(false);
  });
});
