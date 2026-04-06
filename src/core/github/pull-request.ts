import type { SessionMetadata } from '../sessions/schema.js';

export interface PullRequestContent {
  title: string;
  body: string;
}

export function buildPullRequestContent(
  session: SessionMetadata,
  prDraft: string | null,
): PullRequestContent {
  if (!prDraft || prDraft.trim().length === 0) {
    return {
      title: `Hydraz: ${session.name}`,
      body: [
        `Automated pull request created by Hydraz for session "${session.name}".`,
        '',
        `Task: ${session.task}`,
      ].join('\n'),
    };
  }

  const lines = prDraft.trim().split('\n');
  const firstLine = lines[0]?.trim() ?? '';
  if (firstLine.startsWith('# ')) {
    const title = firstLine.slice(2).trim();
    const body = lines.slice(1).join('\n').trim();
    return {
      title: title.length > 0 ? title : `Hydraz: ${session.name}`,
      body: body.length > 0 ? body : `Automated pull request for session "${session.name}".`,
    };
  }

  return {
    title: `Hydraz: ${session.name}`,
    body: prDraft.trim(),
  };
}
