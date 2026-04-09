import { writeFileSync } from 'node:fs';
import { ensureSwarmDirs } from './artifacts.js';
import { runSwarmPipeline, type PipelineOptions, type PipelineResult } from './pipeline.js';

export const RESULT_PATH = '/tmp/hydraz-pipeline-result.json';

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
