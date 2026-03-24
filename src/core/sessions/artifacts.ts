import { existsSync, readFileSync } from 'node:fs';
import { getArtifactPath } from './manager.js';
import { ARTIFACT_FILES, type ArtifactFile } from './schema.js';

export interface ArtifactSummary {
  file: ArtifactFile;
  exists: boolean;
  preview?: string;
  sizeBytes?: number;
}

export function loadArtifact(repoRoot: string, sessionId: string, file: ArtifactFile): string | null {
  const path = getArtifactPath(repoRoot, sessionId, file);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function summarizeArtifacts(repoRoot: string, sessionId: string): ArtifactSummary[] {
  return ARTIFACT_FILES.map((file) => {
    const path = getArtifactPath(repoRoot, sessionId, file);
    if (!existsSync(path)) {
      return { file, exists: false };
    }

    const content = readFileSync(path, 'utf-8');
    return {
      file,
      exists: true,
      preview: content.slice(0, 120).replace(/\n/g, ' ').trim(),
      sizeBytes: Buffer.byteLength(content),
    };
  });
}

export function getArtifactStatus(artifacts: ArtifactSummary[]): string {
  const present = artifacts.filter((a) => a.exists).length;
  const total = artifacts.length;
  return `${present}/${total} artifacts produced`;
}
