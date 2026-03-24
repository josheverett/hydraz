import { loadMasterPrompt } from '../config/master-prompt.js';
import { getPersonaContent } from '../personas/manager.js';
import type { SessionMetadata } from '../sessions/schema.js';

export interface PromptLayer {
  name: string;
  source: string;
  content: string;
}

export interface AssembledPrompt {
  layers: PromptLayer[];
  fullText: string;
  sessionId: string;
  personas: [string, string, string];
}

export function assemblePrompt(
  session: SessionMetadata,
  configDir?: string,
): AssembledPrompt {
  const layers: PromptLayer[] = [];

  const masterPrompt = loadMasterPrompt(configDir);
  layers.push({
    name: 'master',
    source: 'master-prompt.md',
    content: masterPrompt,
  });

  for (const personaName of session.personas) {
    const content = getPersonaContent(personaName, configDir);
    layers.push({
      name: `persona:${personaName}`,
      source: `personas/${personaName}.md`,
      content: content ?? `[Persona "${personaName}" not found]`,
    });
  }

  layers.push({
    name: 'task',
    source: 'session-input',
    content: formatTaskPrompt(session),
  });

  const fullText = layers.map((l) => l.content).join('\n\n---\n\n');

  return {
    layers,
    fullText,
    sessionId: session.id,
    personas: [...session.personas],
  };
}

function formatTaskPrompt(session: SessionMetadata): string {
  return `## Task

**Session:** ${session.name}
**Branch:** ${session.branchName}
**Execution target:** ${session.executionTarget}

${session.task}
`;
}

export function describePromptSources(prompt: AssembledPrompt): string {
  const lines = ['Prompt layers:'];
  for (const layer of prompt.layers) {
    const preview = layer.content.slice(0, 60).replace(/\n/g, ' ');
    lines.push(`  ${layer.name} (${layer.source}): ${preview}...`);
  }
  return lines.join('\n');
}
