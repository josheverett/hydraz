import { launchClaude, type ExecutorResult } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import { readInvestigationBrief } from './artifacts.js';
import { buildInvestigatorPrompt } from './prompts/investigator.js';

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
  swarmDir?: string;
}

export async function runInvestigation(options: InvestigatorOptions): Promise<InvestigationResult> {
  const prompt = buildInvestigatorPrompt(options.task, options.sessionName, options.swarmDir);

  const executor = launchClaude({
    workingDirectory: options.workingDirectory,
    prompt,
    config: options.config,
  });

  const executorResult = await executor.waitForExit();

  if (!executorResult.success) {
    return {
      success: false,
      briefPath: null,
      executorResult,
      error: `Investigator Claude process failed: exit code ${executorResult.exitCode}`,
    };
  }

  const brief = readInvestigationBrief(options.repoRoot, options.sessionId);
  if (!brief) {
    return {
      success: false,
      briefPath: null,
      executorResult,
      error: 'Investigator completed but did not produce swarm/investigation/brief.md',
    };
  }

  const { getSwarmDir } = await import('./artifacts.js');
  const briefPath = `${getSwarmDir(options.repoRoot, options.sessionId)}/investigation/brief.md`;

  return {
    success: true,
    briefPath,
    executorResult,
  };
}
