import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDefaultConfig } from '../config/schema.js';

vi.mock('./pipeline.js', () => ({
  runSwarmPipeline: vi.fn().mockResolvedValue({
    success: true,
    phase: 'completed',
    outerLoopsUsed: 1,
    consensusRoundsUsed: 1,
    approved: true,
  }),
}));

vi.mock('./artifacts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./artifacts.js')>();
  return {
    ...actual,
    ensureSwarmDirs: vi.fn(),
  };
});

import {
  RESULT_PATH,
  toSerializable,
  toPipelineOptions,
  executePipeline,
  runMain,
  type SerializablePipelineOptions,
} from './pipeline-runner.js';
import { runSwarmPipeline } from './pipeline.js';
import { ensureSwarmDirs } from './artifacts.js';

function makeSerializedOptions(overrides: Partial<SerializablePipelineOptions> = {}): SerializablePipelineOptions {
  return {
    repoRoot: '/repo',
    sessionId: 'sess-1',
    sessionName: 'test',
    task: 'Build it',
    workingDirectory: '/work',
    config: createDefaultConfig(),
    workerCount: 3,
    reviewerPersonas: [{ name: 'carmack', persona: 'Find bugs.' }],
    maxOuterLoops: 5,
    maxConsensusRounds: 10,
    parallel: false,
    ...overrides,
  };
}

describe('pipeline-runner', () => {
  describe('RESULT_PATH', () => {
    it('should be a fixed path under /tmp', () => {
      expect(RESULT_PATH).toBe('/tmp/hydraz-pipeline-result.json');
    });
  });

  describe('toSerializable', () => {
    it('should strip callbacks from PipelineOptions', () => {
      const serialized = toSerializable({
        repoRoot: '/repo',
        sessionId: 'abc123',
        sessionName: 'test',
        task: 'Build it',
        workingDirectory: '/work',
        config: createDefaultConfig(),
        workerCount: 3,
        reviewerPersonas: [{ name: 'carmack', persona: 'Find bugs.' }],
        maxOuterLoops: 5,
        maxConsensusRounds: 10,
        callbacks: { onPhaseChange: () => {} },
      });

      expect(serialized).not.toHaveProperty('callbacks');
      expect(serialized.repoRoot).toBe('/repo');
      expect(serialized.sessionId).toBe('abc123');
      expect(serialized.workerCount).toBe(3);
    });

    it('should preserve all pipeline-relevant fields', () => {
      const config = createDefaultConfig();
      const personas = [{ name: 'metz', persona: 'Design quality.' }];

      const serialized = toSerializable({
        repoRoot: '/my/repo',
        sessionId: 'session-1',
        sessionName: 'my-session',
        task: 'Do the thing',
        workingDirectory: '/work/dir',
        config,
        workerCount: 5,
        reviewerPersonas: personas,
        maxOuterLoops: 3,
        maxConsensusRounds: 8,
        parallel: false,
      });

      expect(serialized.repoRoot).toBe('/my/repo');
      expect(serialized.sessionId).toBe('session-1');
      expect(serialized.sessionName).toBe('my-session');
      expect(serialized.task).toBe('Do the thing');
      expect(serialized.workingDirectory).toBe('/work/dir');
      expect(serialized.config).toEqual(config);
      expect(serialized.workerCount).toBe(5);
      expect(serialized.reviewerPersonas).toEqual(personas);
      expect(serialized.maxOuterLoops).toBe(3);
      expect(serialized.maxConsensusRounds).toBe(8);
    });

    it('should include parallel in serialized output', () => {
      const serialized = toSerializable({
        repoRoot: '/repo',
        sessionId: 'abc',
        sessionName: 'test',
        task: 'Build it',
        workingDirectory: '/work',
        config: createDefaultConfig(),
        workerCount: 3,
        reviewerPersonas: [],
        maxOuterLoops: 5,
        maxConsensusRounds: 10,
        parallel: true,
      });

      expect(serialized.parallel).toBe(true);
    });
  });

  describe('toPipelineOptions', () => {
    it('should convert serialized options back to PipelineOptions with all fields', () => {
      const serialized = makeSerializedOptions({
        repoRoot: '/container/repo',
        sessionId: 'abc',
        task: 'Build it',
        workerCount: 4,
      });

      const options = toPipelineOptions(serialized);

      expect(options.repoRoot).toBe('/container/repo');
      expect(options.sessionId).toBe('abc');
      expect(options.task).toBe('Build it');
      expect(options.workerCount).toBe(4);
    });

    it('should not include containerContext', () => {
      const options = toPipelineOptions(makeSerializedOptions());
      expect(options).not.toHaveProperty('containerContext');
    });

    it('should add callbacks with phase, event, and error handlers', () => {
      const options = toPipelineOptions(makeSerializedOptions());

      expect(options.callbacks).toBeDefined();
      expect(options.callbacks?.onPhaseChange).toBeTypeOf('function');
      expect(options.callbacks?.onEvent).toBeTypeOf('function');
      expect(options.callbacks?.onError).toBeTypeOf('function');
    });

    it('should preserve parallel field through round-trip', () => {
      const options = toPipelineOptions(makeSerializedOptions({ parallel: true }));
      expect(options.parallel).toBe(true);
    });
  });

  describe('executePipeline', () => {
    let resultDir: string;
    let resultPath: string;

    beforeEach(() => {
      resultDir = mkdtempSync(join(tmpdir(), 'hydraz-runner-test-'));
      resultPath = join(resultDir, 'result.json');
      vi.clearAllMocks();
    });

    afterEach(() => {
      rmSync(resultDir, { recursive: true, force: true });
    });

    it('should call ensureSwarmDirs with repoRoot and sessionId', async () => {
      await executePipeline(makeSerializedOptions({
        repoRoot: '/container/repo',
        sessionId: 'sess-42',
      }), resultPath);

      expect(ensureSwarmDirs).toHaveBeenCalledWith('/container/repo', 'sess-42');
    });

    it('should call runSwarmPipeline with deserialized options', async () => {
      await executePipeline(makeSerializedOptions({
        repoRoot: '/container/repo',
        workerCount: 2,
        reviewerPersonas: [{ name: 'carmack', persona: 'Find bugs.' }],
      }), resultPath);

      expect(runSwarmPipeline).toHaveBeenCalledTimes(1);
      const calledWith = vi.mocked(runSwarmPipeline).mock.calls[0]![0]!;
      expect(calledWith.repoRoot).toBe('/container/repo');
      expect(calledWith.workerCount).toBe(2);
      expect(calledWith.callbacks).toBeDefined();
    });

    it('should write PipelineResult as JSON to the result path', async () => {
      const result = await executePipeline(makeSerializedOptions(), resultPath);

      expect(existsSync(resultPath)).toBe(true);
      const written = JSON.parse(readFileSync(resultPath, 'utf-8'));
      expect(written.success).toBe(true);
      expect(written.phase).toBe('completed');
      expect(written.approved).toBe(true);
      expect(result).toEqual(written);
    });

    it('should handle pipeline failure and still write result', async () => {
      vi.mocked(runSwarmPipeline).mockResolvedValueOnce({
        success: false,
        phase: 'investigating',
        outerLoopsUsed: 0,
        consensusRoundsUsed: 0,
        approved: false,
        error: 'Investigation failed',
      });

      const result = await executePipeline(makeSerializedOptions(), resultPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Investigation failed');

      const written = JSON.parse(readFileSync(resultPath, 'utf-8'));
      expect(written.success).toBe(false);
      expect(written.error).toBe('Investigation failed');
    });
  });

  describe('runMain', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    const origEnv = process.env;

    beforeEach(() => {
      vi.clearAllMocks();
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env = { ...origEnv };
      delete process.env.HYDRAZ_PIPELINE_OPTIONS;
    });

    afterEach(() => {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
      process.env = origEnv;
      try { rmSync(RESULT_PATH, { force: true }); } catch {}
    });

    it('should exit 1 with error when HYDRAZ_PIPELINE_OPTIONS is not set', async () => {
      await runMain();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('HYDRAZ_PIPELINE_OPTIONS'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit 1 with error when HYDRAZ_PIPELINE_OPTIONS is invalid JSON', async () => {
      process.env.HYDRAZ_PIPELINE_OPTIONS = '{not valid json';

      await runMain();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should parse options from env, run the pipeline, and exit 0 on success', async () => {
      const options = makeSerializedOptions({ repoRoot: '/container', sessionId: 'main-test' });
      process.env.HYDRAZ_PIPELINE_OPTIONS = JSON.stringify(options);

      await runMain();

      expect(ensureSwarmDirs).toHaveBeenCalledWith('/container', 'main-test');
      expect(runSwarmPipeline).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);

      const written = JSON.parse(readFileSync(RESULT_PATH, 'utf-8'));
      expect(written.success).toBe(true);
    });

    it('should exit 1 and write error to stderr when pipeline throws', async () => {
      vi.mocked(runSwarmPipeline).mockRejectedValueOnce(new Error('Pipeline exploded'));

      const options = makeSerializedOptions();
      process.env.HYDRAZ_PIPELINE_OPTIONS = JSON.stringify(options);
      await runMain();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline exploded'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
