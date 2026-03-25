import { describe, it, expect, vi } from 'vitest';
import { getProvider } from './controller.js';
import { LocalProvider } from '../providers/local.js';
import { CloudProvider } from '../providers/cloud.js';
import { LocalContainerProvider } from '../providers/local-container.js';

describe('getProvider', () => {
  it('returns LocalProvider for local target', () => {
    expect(getProvider('local')).toBeInstanceOf(LocalProvider);
  });

  it('returns LocalContainerProvider for local-container target', () => {
    expect(getProvider('local-container')).toBeInstanceOf(LocalContainerProvider);
  });

  it('returns CloudProvider for cloud target', () => {
    expect(getProvider('cloud')).toBeInstanceOf(CloudProvider);
  });
});

describe('controller integration', () => {
  it('stopSession is a function', async () => {
    const { stopSession } = await import('./controller.js');
    expect(typeof stopSession).toBe('function');
  });

  it('resumeSession is a function', async () => {
    const { resumeSession } = await import('./controller.js');
    expect(typeof resumeSession).toBe('function');
  });

  it('isSessionRunning returns false for unknown sessions', async () => {
    const { isSessionRunning } = await import('./controller.js');
    expect(isSessionRunning('nonexistent')).toBe(false);
  });
});
