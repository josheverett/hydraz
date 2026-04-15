import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateHelloWorldTask,
  expectedFileName,
  verifyLocalFile,
  formatHelloWorldReport,
  type HelloWorldStep,
  type HelloWorldResult,
} from './hello-world.js';

describe('generateHelloWorldTask', () => {
  it('should include the unix timestamp in the task', () => {
    const task = generateHelloWorldTask(1713139200);
    expect(task).toContain('hello-world-1713139200.txt');
  });

  it('should instruct Claude to write exact contents "hello world"', () => {
    const task = generateHelloWorldTask(1713139200);
    expect(task).toContain('hello world');
  });
});

describe('expectedFileName', () => {
  it('should return the hello-world filename with the timestamp', () => {
    expect(expectedFileName(1713139200)).toBe('hello-world-1713139200.txt');
  });
});

describe('verifyLocalFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hydraz-hw-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should return found=true and contentsMatch=true when file has correct contents', () => {
    writeFileSync(join(dir, 'hello-world-123.txt'), 'hello world');
    const result = verifyLocalFile(dir, 'hello-world-123.txt');
    expect(result.found).toBe(true);
    expect(result.contentsMatch).toBe(true);
  });

  it('should return found=true and contentsMatch=false when file has wrong contents', () => {
    writeFileSync(join(dir, 'hello-world-123.txt'), 'wrong stuff');
    const result = verifyLocalFile(dir, 'hello-world-123.txt');
    expect(result.found).toBe(true);
    expect(result.contentsMatch).toBe(false);
    expect(result.actualContents).toBe('wrong stuff');
  });

  it('should return found=false when file does not exist', () => {
    const result = verifyLocalFile(dir, 'hello-world-999.txt');
    expect(result.found).toBe(false);
    expect(result.contentsMatch).toBe(false);
  });
});

describe('formatHelloWorldReport', () => {
  it('should format a passing result with all steps ok', () => {
    const result: HelloWorldResult = {
      passed: true,
      timestamp: 1713139200,
      fileName: 'hello-world-1713139200.txt',
      steps: [
        { name: 'Auth', status: 'ok', detail: 'Claude.ai subscription' },
        { name: 'Workspace', status: 'ok', detail: 'hydraz-hello-world-abc1' },
        { name: 'Claude', status: 'ok', detail: 'exit 0, 12s' },
        { name: 'Verification', status: 'ok', detail: 'hello-world-1713139200.txt' },
        { name: 'Cleanup', status: 'ok' },
      ],
    };

    const report = formatHelloWorldReport(result);
    expect(report).toContain('PASS');
    expect(report).toContain('Auth');
    expect(report).toContain('ok');
    expect(report).not.toContain('FAIL');
  });

  it('should format a failing result highlighting the failed step', () => {
    const result: HelloWorldResult = {
      passed: false,
      timestamp: 1713139200,
      steps: [
        { name: 'Auth', status: 'ok', detail: 'Claude.ai subscription' },
        { name: 'Workspace', status: 'fail', detail: 'DevPod not available' },
        { name: 'Claude', status: 'skip' },
        { name: 'Verification', status: 'skip' },
        { name: 'Cleanup', status: 'skip' },
      ],
    };

    const report = formatHelloWorldReport(result);
    expect(report).toContain('FAIL');
    expect(report).toContain('Workspace');
    expect(report).toContain('DevPod not available');
  });
});
