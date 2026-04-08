import { launchClaude, type ExecutorResult, type ContainerContext } from '../claude/executor.js';
import type { HydrazConfig } from '../config/schema.js';
import { readArchitectureDesign, getSwarmDir } from './artifacts.js';
import { buildArchitectPrompt } from './prompts/architect.js';

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
  swarmDir?: string;
  containerContext?: ContainerContext;
}

export async function runArchitect(options: ArchitectOptions): Promise<ArchitectResult> {
  const prompt = buildArchitectPrompt(options.task, options.sessionName, options.investigationBrief, options.swarmDir);

  const executor = launchClaude({
    workingDirectory: options.workingDirectory,
    prompt,
    config: options.config,
    containerContext: options.containerContext,
  });

  const executorResult = await executor.waitForExit();

  if (!executorResult.success) {
    return {
      success: false,
      designPath: null,
      executorResult,
      error: `Architect Claude process failed: exit code ${executorResult.exitCode}`,
    };
  }

  const design = readArchitectureDesign(options.repoRoot, options.sessionId);
  if (!design) {
    return {
      success: false,
      designPath: null,
      executorResult,
      error: 'Architect completed but did not produce swarm/architecture/design.md',
    };
  }

  const designPath = `${getSwarmDir(options.repoRoot, options.sessionId)}/architecture/design.md`;

  return {
    success: true,
    designPath,
    executorResult,
  };
}
