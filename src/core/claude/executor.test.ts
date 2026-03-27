import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildClaudeArgs, buildClaudeEnv, mapExitToSessionState } from './executor.js';
import { createDefaultConfig } from '../config/schema.js';
import { createSession } from '../sessions/schema.js';
import { assemblePrompt } from '../prompts/builder.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeConfigDir } from '../config/init.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'hydraz-executor-test-'));
  initializeConfigDir(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function makePrompt() {
  const session = createSession({
    name: 'test',
    repoRoot: '/tmp/repo',
    branchName: 'hydraz/test',
    personas: ['architect', 'implementer', 'verifier'],
    executionTarget: 'local',
    task: 'Fix the bug',
  });
  return assemblePrompt(session, testDir);
}

describe('buildClaudeArgs', () => {
  it('includes --print flag', () => {
    const args = buildClaudeArgs(makePrompt());
    expect(args).toContain('--print');
  });

  it('uses stream-json output format', () => {
    const args = buildClaudeArgs(makePrompt());
    const fmtIdx = args.indexOf('--output-format');
    expect(fmtIdx).toBeGreaterThan(-1);
    expect(args[fmtIdx + 1]).toBe('stream-json');
  });

  it('includes the full prompt text as the last argument', () => {
    const prompt = makePrompt();
    const args = buildClaudeArgs(prompt);
    expect(args[args.length - 1]).toBe(prompt.fullText);
  });

  it('includes --verbose (required by stream-json)', () => {
    const args = buildClaudeArgs(makePrompt());
    expect(args).toContain('--verbose');
  });

  it('includes --dangerously-skip-permissions for autonomous operation', () => {
    const args = buildClaudeArgs(makePrompt());
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('pins model to claude-opus-4-6', () => {
    const args = buildClaudeArgs(makePrompt());
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

  it('does not forward non-allowlisted env vars', () => {
    vi.stubEnv('MY_CUSTOM_VAR', 'hello');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret123');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_xxx');
    const config = createDefaultConfig();
    const env = buildClaudeEnv(config, '/tmp/workspace');
    expect(env['MY_CUSTOM_VAR']).toBeUndefined();
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
  });

  it('forwards allowlisted env vars like PATH and HOME', () => {
    vi.stubEnv('PATH', '/usr/bin:/usr/local/bin');
    vi.stubEnv('HOME', '/home/test');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    const config = createDefaultConfig();
    const env = buildClaudeEnv(config, '/tmp/workspace');
    expect(env['PATH']).toBe('/usr/bin:/usr/local/bin');
    expect(env['HOME']).toBe('/home/test');
    expect(env['LANG']).toBe('en_US.UTF-8');
  });

  it('forwards LC_ prefixed locale vars', () => {
    vi.stubEnv('LC_ALL', 'en_US.UTF-8');
    vi.stubEnv('LC_CTYPE', 'UTF-8');
    const config = createDefaultConfig();
    const env = buildClaudeEnv(config, '/tmp/workspace');
    expect(env['LC_ALL']).toBe('en_US.UTF-8');
    expect(env['LC_CTYPE']).toBe('UTF-8');
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
