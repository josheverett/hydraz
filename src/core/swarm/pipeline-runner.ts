import type { PipelineOptions, PipelineResult } from './pipeline.js';

export const RESULT_PATH = '';

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

export function toSerializable(_options: PipelineOptions): SerializablePipelineOptions {
  return undefined as unknown as SerializablePipelineOptions;
}

export function toPipelineOptions(_serialized: SerializablePipelineOptions): PipelineOptions {
  return undefined as unknown as PipelineOptions;
}

export async function executePipeline(
  _serialized: SerializablePipelineOptions,
  _resultPath: string,
): Promise<PipelineResult> {
  return undefined as unknown as PipelineResult;
}
