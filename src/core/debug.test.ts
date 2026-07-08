import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setVerbose, isVerbose, debug, debugExec, debugOutput, debugTiming } from './debug.js';

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setVerbose(false);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('setVerbose / isVerbose', () => {
  it('defaults to false', () => {
    expect(isVerbose()).toBe(false);
  });

  it('can be enabled', () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });

  it('can be toggled back to false', () => {
    setVerbose(true);
    setVerbose(false);
    expect(isVerbose()).toBe(false);
  });
});

describe('debug', () => {
  it('writes to stderr when verbose', () => {
    setVerbose(true);
    debug('hello');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });

  it('includes [debug <timestamp>] prefix', () => {
    setVerbose(true);
    debug('test message');
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toMatch(/\[debug \d{2}:\d{2}:\d{2}\.\d{3}\]/);
  });

  it('does not write when not verbose', () => {
    debug('silent');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('appends a newline', () => {
    setVerbose(true);
    debug('newline check');
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written.endsWith('\n')).toBe(true);
  });

  it('redacts secrets in debug messages', () => {
    setVerbose(true);
    debug('token github_pat_abc123');
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('[REDACTED]');
    expect(written).not.toContain('github_pat_abc123');
  });
});

describe('debugExec', () => {
  it('prints the command and arguments', () => {
    setVerbose(true);
    debugExec('devpod', ['up', 'git@github.com:org/repo.git', '--ide', 'none']);
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('exec:');
    expect(written).toContain('devpod');
    expect(written).toContain('git@github.com:org/repo.git');
    expect(written).toContain('--ide');
    expect(written).toContain('none');
  });

  it('redacts secrets in command arguments while preserving command context', () => {
    setVerbose(true);
    debugExec('ssh', [
      'hydraz-test.devpod',
      `HYDRAZ_CODEX_RUNNER_OPTIONS='${JSON.stringify({
        config: { github: { token: 'github_pat_abc123' } },
        branchName: 'hydraz/test',
      })}'`,
    ]);

    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('exec: ssh');
    expect(written).toContain('HYDRAZ_CODEX_RUNNER_OPTIONS');
    expect(written).toContain('hydraz/test');
    expect(written).toContain('"token":"[REDACTED]"');
    expect(written).not.toContain('github_pat_abc123');
  });

  it('is silent when not verbose', () => {
    debugExec('devpod', ['version']);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe('debugOutput', () => {
  it('prints labeled output', () => {
    setVerbose(true);
    debugOutput('stdout', 'v0.6.15\n');
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('stdout');
    expect(written).toContain('v0.6.15');
  });

  it('is silent when not verbose', () => {
    debugOutput('stdout', 'data');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('handles multiline output', () => {
    setVerbose(true);
    debugOutput('stderr', 'line1\nline2\nline3');
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('line1');
    expect(written).toContain('line3');
  });

  it('redacts secrets in command output', () => {
    setVerbose(true);
    debugOutput('env', 'GH_TOKEN=github_pat_abc123\nOPENAI_API_KEY=sk-test123\n');
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('GH_TOKEN=[REDACTED]');
    expect(written).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(written).not.toContain('github_pat_abc123');
    expect(written).not.toContain('sk-test123');
  });
});

describe('debugTiming', () => {
  it('prints label and milliseconds', () => {
    setVerbose(true);
    debugTiming('devpod up', 4321);
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('devpod up');
    expect(written).toContain('4321ms');
  });

  it('redacts secrets in timing labels', () => {
    setVerbose(true);
    debugTiming('token github_pat_abc123', 1);
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('[REDACTED]');
    expect(written).not.toContain('github_pat_abc123');
  });

  it('is silent when not verbose', () => {
    debugTiming('devpod up', 100);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
