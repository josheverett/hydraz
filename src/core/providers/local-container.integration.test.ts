import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../config/schema.js';
import { createSession } from '../sessions/schema.js';
import { devpodDelete, devpodStatus, sshExec } from './devpod.js';
import { LocalContainerProvider } from './local-container.js';

const fixtureRepo = fileURLToPath(
  new URL('../../../tests/fixtures/local-container', import.meta.url),
);
const markerPath = '/tmp/hydraz-container-concurrency-marker';

describe.runIf(process.env.HYDRAZ_INTEGRATION === '1')(
  'LocalContainerProvider integration',
  () => {
    it('keeps concurrent local containers isolated through independent teardown', async () => {
      const provider = new LocalContainerProvider();
      const availability = provider.checkAvailability();
      if (!availability.available) {
        throw new Error(`Local-container integration prerequisites unavailable: ${availability.error}`);
      }

      const sessions = ['a', 'b'].map((suffix) => createSession({
        name: `container-integration-${suffix}`,
        repoRoot: fixtureRepo,
        branchName: `hydraz/container-integration-${suffix}`,
        executionTarget: 'local-container',
        task: 'Verify concurrent local containers',
      }));
      const names = sessions.map(({ id }) => `hydraz-${id}`);
      expect(names[0]).not.toBe(names[1]);

      let primaryFailure: unknown;
      try {
        const [resultA, resultB] = await Promise.allSettled(
          sessions.map((session) => provider.createWorkspace({
            session,
            config: createDefaultConfig(),
            skipClone: true,
          })),
        );
        if (resultA.status === 'rejected' || resultB.status === 'rejected') {
          throw new AggregateError(
            [resultA, resultB].flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : []),
            'Concurrent local-container provisioning failed',
          );
        }
        const [workspaceA, workspaceB] = [resultA.value, resultB.value];

        expect(workspaceA.directory).not.toBe(workspaceB.directory);
        expect(names.map(devpodStatus)).toEqual(['Running', 'Running']);
        expect(sshExec(names[0]!, 'hostname').trim()).not.toBe(
          sshExec(names[1]!, 'hostname').trim(),
        );

        sshExec(names[0]!, `printf '%s' '${sessions[0]!.id}' > '${markerPath}'`);
        sshExec(names[1]!, `printf '%s' '${sessions[1]!.id}' > '${markerPath}'`);
        expect(sshExec(names[0]!, `cat '${markerPath}'`)).toBe(sessions[0]!.id);
        expect(sshExec(names[1]!, `cat '${markerPath}'`)).toBe(sessions[1]!.id);

        provider.destroyWorkspace(fixtureRepo, workspaceA);
        expect(devpodStatus(names[0]!)).toBe('NotFound');
        expect(devpodStatus(names[1]!)).toBe('Running');
        expect(sshExec(names[1]!, `cat '${markerPath}'`)).toBe(sessions[1]!.id);

        provider.destroyWorkspace(fixtureRepo, workspaceB);
        expect(devpodStatus(names[1]!)).toBe('NotFound');
      } catch (error) {
        primaryFailure = error;
      } finally {
        const cleanupFailures = new Map<string, unknown>();
        for (const name of names) {
          try {
            devpodDelete(name, true);
          } catch (error) {
            cleanupFailures.set(name, error);
          }
        }
        const leaked = names.filter((name) => devpodStatus(name) !== 'NotFound');
        if (leaked.length > 0) {
          throw new AggregateError(
            [
              ...(primaryFailure === undefined ? [] : [primaryFailure]),
              ...leaked.flatMap((name) =>
                cleanupFailures.has(name) ? [cleanupFailures.get(name)] : []),
            ],
            `Container integration cleanup failed; remaining: ${leaked.join(', ') || 'none'}`,
          );
        }
      }
      if (primaryFailure !== undefined) throw primaryFailure;
    }, 1_800_000);
  },
);
