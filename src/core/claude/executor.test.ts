import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildClaudeArgs, buildClaudeEnv, mapExitToSessionState } from './executor.js';
import { createDefaultConfig } from '../config/schema.js';

const TEST_PROMPT = 'You are a test agent. Do the thing.';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildClaudeArgs', () => {
  it('includes --print flag', () => {
    const args = buildClaudeArgs(TEST_PROMPT);
    expect(args).toContain('--print');
  });

  it('uses stream-json output format', () => {
    const args = buildClaudeArgs(TEST_PROMPT);
    const fmtIdx = args.indexOf('--output-format');
    expect(fmtIdx).toBeGreaterThan(-1);
    expect(args[fmtIdx + 1]).toBe('stream-json');
  });

  it('includes the prompt text as the last argument', () => {
    const args = buildClaudeArgs(TEST_PROMPT);
    expect(args[args.length - 1]).toBe(TEST_PROMPT);
  });

  it('includes --verbose (required by stream-json)', () => {
    const args = buildClaudeArgs(TEST_PROMPT);
    expect(args).toContain('--verbose');
  });

  it('includes --dangerously-skip-permissions for autonomous operation', () => {
    const args = buildClaudeArgs(TEST_PROMPT);
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('pins model to claude-opus-4-6', () => {
    const args = buildClaudeArgs(TEST_PROMPT);
    const modelIdx = args.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(args[modelIdx + 1]).toBe('claude-opus-4-6');
  });
});

describe('buildClaudeEnv', () => {
  it('sets HYDRAZ_SESSION to true', () => {
    const config = createDefaultConfig();
    const env = buildClaudeEnv(config, '/tmp/workspace');
    expect(env['HYDRAZ_SESSION']).toBe('true');
  });

  it('sets HYDRAZ_WORKSPACE to the working directory', () => {
    const config = createDefaultConfig();
    const env = buildClaudeEnv(config, '/tmp/workspace');
    expect(env['HYDRAZ_WORKSPACE']).toBe('/tmp/workspace');
  });

  it('includes ANTHROPIC_API_KEY when in api-key mode and env is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-key');
    const config = createDefaultConfig();
    config.claudeAuth.mode = 'api-key';
    const env = buildClaudeEnv(config, '/tmp/workspace');
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-test-key');
  });

  it('inherits existing process.env', () => {
    vi.stubEnv('MY_CUSTOM_VAR', 'hello');
    const config = createDefaultConfig();
    const env = buildClaudeEnv(config, '/tmp/workspace');
    expect(env['MY_CUSTOM_VAR']).toBe('hello');
  });
});

describe('mapExitToSessionState', () => {
  it('maps exit code 0 to completed', () => {
    const result = mapExitToSessionState({ exitCode: 0, signal: null, success: true });
    expect(result.state).toBe('completed');
  });

  it('maps non-zero exit code to failed with message', () => {
    const result = mapExitToSessionState({ exitCode: 1, signal: null, success: false });
    expect(result.state).toBe('failed');
    expect(result.message).toContain('code 1');
  });

  it('maps signal kill to failed with signal info', () => {
    const result = mapExitToSessionState({ exitCode: null, signal: 'SIGTERM', success: false });
    expect(result.state).toBe('failed');
    expect(result.message).toContain('SIGTERM');
  });
});
