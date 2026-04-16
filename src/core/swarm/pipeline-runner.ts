import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ensureSwarmDirs } from './artifacts.js';
import { runSwarmPipeline, type PipelineOptions, type PipelineResult } from './pipeline.js';

export const RESULT_PATH = '/tmp/hydraz-pipeline-result.json';
export const CONTAINER_DIST_PATH = '/tmp/hydraz-dist';
export const CONTAINER_RUNNER_SCRIPT = `${CONTAINER_DIST_PATH}/core/swarm/pipeline-runner.js`;

export interface SerializablePipelineOptions {
  repoRoot: string;
  sessionId: string;
  sessionName: string;
  task: string;
  workingDirectory: string;
  config: import('../config/schema.js').HydrazConfig;
  workerCount: number;
  reviewerPersonas: Array<{ name: string; persona: string }>;
  maxOuterLoops: number;
  maxConsensusRounds: number;
  parallel: boolean;
}

export function toSerializable(options: PipelineOptions): SerializablePipelineOptions {
  return {
    repoRoot: options.repoRoot,
    sessionId: options.sessionId,
    sessionName: options.sessionName,
    task: options.task,
    workingDirectory: options.workingDirectory,
    config: options.config,
    workerCount: options.workerCount,
    reviewerPersonas: options.reviewerPersonas,
    maxOuterLoops: options.maxOuterLoops,
    maxConsensusRounds: options.maxConsensusRounds,
    parallel: options.parallel,
  };
}

export function toPipelineOptions(serialized: SerializablePipelineOptions): PipelineOptions {
  return {
    repoRoot: serialized.repoRoot,
    sessionId: serialized.sessionId,
    sessionName: serialized.sessionName,
    task: serialized.task,
    workingDirectory: serialized.workingDirectory,
    config: serialized.config,
    workerCount: serialized.workerCount,
    reviewerPersonas: serialized.reviewerPersonas,
    maxOuterLoops: serialized.maxOuterLoops,
    maxConsensusRounds: serialized.maxConsensusRounds,
    parallel: serialized.parallel,
    callbacks: {
      onPhaseChange: (phase) => {
        process.stdout.write(JSON.stringify({ type: 'phase', phase }) + '\n');
      },
      onEvent: (type, message) => {
        process.stdout.write(JSON.stringify({ type: 'event', eventType: type, message }) + '\n');
      },
      onError: (message) => {
        process.stderr.write(message + '\n');
      },
    },
  };
}

export async function executePipeline(
  serialized: SerializablePipelineOptions,
  resultPath: string,
): Promise<PipelineResult> {
  ensureSwarmDirs(serialized.repoRoot, serialized.sessionId);
  const options = toPipelineOptions(serialized);
  const result = await runSwarmPipeline(options);
  writeFileSync(resultPath, JSON.stringify(result));
  return result;
}

export async function runMain(args: string[]): Promise<void> {
  const json = args[2];
  if (!json) {
    process.stderr.write('Usage: node pipeline-runner.js <options-json>\n');
    process.exit(1);
    return;
  }

  let parsed: SerializablePipelineOptions;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    process.stderr.write(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
    return;
  }

  try {
    await executePipeline(parsed, RESULT_PATH);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Pipeline failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

let isMain = false;
try {
  isMain = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
} catch { /* import.meta.url unavailable in SEA/CJS mode */ }
if (isMain) {
  runMain(process.argv);
}
