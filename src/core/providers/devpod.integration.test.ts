import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  composeProjectName,
  devpodDelete,
  devpodUp,
  getContainerRepoPath,
  removeComposeProjectVolumes,
} from './devpod.js';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../integration-fixtures/compose-devcontainer',
);

function listDockerResources(resource: 'container' | 'volume', projectName: string): string[] {
  const args = resource === 'container'
    ? ['container', 'ls', '-a', '-q', '--filter', `label=com.docker.compose.project=${projectName}`]
    : ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${projectName}`];
  const output = execFileSync(
    'docker',
    args,
    { encoding: 'utf-8' },
  );
  return output.trim().split(/\s+/).filter(Boolean);
}

describe.skipIf(process.env.HYDRAZ_DEVPOD_INTEGRATION !== '1')(
  'DevPod Compose integration',
  () => {
    it('discovers a custom workspace root and removes leaked Compose volumes', { timeout: 900_000 }, async () => {
      const repoDir = mkdtempSync(join(tmpdir(), 'hydraz-devpod-integration-'));
      const workspaceName = `hydraz-int-${randomUUID().slice(0, 20)}`;
      const projectName = composeProjectName(workspaceName);
      cpSync(fixtureDir, repoDir, { recursive: true });

      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'Hydraz Integration Test'], { cwd: repoDir });
      execFileSync('git', ['config', 'user.email', 'hydraz-integration@example.com'], { cwd: repoDir });
      execFileSync('git', ['add', '.'], { cwd: repoDir });
      execFileSync('git', ['commit', '-m', 'Create integration fixture'], { cwd: repoDir, stdio: 'pipe' });

      try {
        await devpodUp(
          repoDir,
          workspaceName,
          'docker',
          undefined,
          undefined,
          undefined,
          undefined,
          { COMPOSE_PROJECT_NAME: projectName },
        );

        expect(getContainerRepoPath(workspaceName)).toBe('/workspaces/fixture-app');
        expect(listDockerResources('volume', projectName)).not.toHaveLength(0);

        devpodDelete(workspaceName);
        expect(listDockerResources('volume', projectName)).not.toHaveLength(0);

        removeComposeProjectVolumes(projectName);
        expect(listDockerResources('volume', projectName)).toHaveLength(0);
        expect(listDockerResources('container', projectName)).toHaveLength(0);
      } finally {
        try {
          devpodDelete(workspaceName, true);
        } catch {
          // The normal test path already deleted the workspace.
        }
        removeComposeProjectVolumes(projectName);
        rmSync(repoDir, { recursive: true, force: true });
      }
    });
  },
);
