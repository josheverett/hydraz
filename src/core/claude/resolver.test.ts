import { describe, it, expect } from 'vitest';
import { formatAuthResolution, type AuthResolution } from './resolver.js';

describe('formatAuthResolution', () => {
  it('formats a fully resolved auth', () => {
    const auth: AuthResolution = {
      resolved: true,
      mode: 'claude-ai-oauth',
      modeDescription: 'Claude.ai subscription (OAuth)',
      claudeAvailable: true,
      claudeVersion: '1.2.3',
      errors: [],
    };
    const output = formatAuthResolution(auth);
    expect(output).toContain('Claude.ai subscription (OAuth)');
    expect(output).toContain('v1.2.3');
    expect(output).toContain('ready');
  });

  it('formats auth with errors', () => {
    const auth: AuthResolution = {
      resolved: false,
      mode: 'api-key',
      modeDescription: 'API key',
      claudeAvailable: false,
      errors: ['Claude Code CLI is not available.', 'ANTHROPIC_API_KEY not set.'],
    };
    const output = formatAuthResolution(auth);
    expect(output).toContain('NOT FOUND');
    expect(output).toContain('Claude Code CLI is not available.');
    expect(output).toContain('ANTHROPIC_API_KEY not set.');
  });

  it('shows Claude as available without version', () => {
    const auth: AuthResolution = {
      resolved: true,
      mode: 'claude-ai-oauth',
      modeDescription: 'Claude.ai subscription (OAuth)',
      claudeAvailable: true,
      errors: [],
    };
    const output = formatAuthResolution(auth);
    expect(output).toContain('available');
    expect(output).not.toContain('undefined');
  });
});
