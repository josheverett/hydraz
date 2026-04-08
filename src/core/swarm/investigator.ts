import type { ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';

export interface InvestigationResult {
  success: boolean;
  briefPath: string | null;
  executorResult: ExecutorResult | null;
  error?: string;
}

export interface InvestigatorOptions {
  repoRoot: string;
  sessionId: string;
  task: string;
  sessionName: string;
  workingDirectory: string;
  config: HydrazConfig;
}

export async function runInvestigation(_options: InvestigatorOptions): Promise<InvestigationResult> {
  return {
    success: false,
    briefPath: null,
    executorResult: null,
    error: 'not implemented',
  };
}
