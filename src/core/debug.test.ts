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
});

describe('debugTiming', () => {
  it('prints label and milliseconds', () => {
    setVerbose(true);
    debugTiming('devpod up', 4321);
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(written).toContain('devpod up');
    expect(written).toContain('4321ms');
  });

  it('is silent when not verbose', () => {
    debugTiming('devpod up', 100);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
