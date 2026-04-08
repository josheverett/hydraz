import type { ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';

export interface ArchitectResult {
  success: boolean;
  designPath: string | null;
  executorResult: ExecutorResult | null;
  error?: string;
}

export interface ArchitectOptions {
  repoRoot: string;
  sessionId: string;
  task: string;
  sessionName: string;
  workingDirectory: string;
  config: HydrazConfig;
  investigationBrief: string;
}

export async function runArchitect(_options: ArchitectOptions): Promise<ArchitectResult> {
  return {
    success: false,
    designPath: null,
    executorResult: null,
    error: 'not implemented',
  };
}
