import { describe, it, expect } from 'vitest';
import { prepareContainerAuthEnv } from './container-auth.js';
import { createDefaultConfig } from '../config/schema.js';

describe('prepareContainerAuthEnv', () => {
  it('returns empty env when no GitHub token is configured', () => {
    const config = createDefaultConfig();
    const env = prepareContainerAuthEnv(config);
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('includes GitHub HTTPS git auth env when a GitHub token is configured', () => {
    const config = createDefaultConfig();
    config.github.token = 'github_pat_test';
    const env = prepareContainerAuthEnv(config);
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
    expect(env['GIT_CONFIG_VALUE_0']).toBe('git@github.com:');
    expect(env['GIT_CONFIG_KEY_2']).toBe('http.https://github.com/.extraheader');
  });

  it('includes GH_TOKEN when a GitHub token is configured', () => {
    const config = createDefaultConfig();
    config.github.token = 'github_pat_test';
    const env = prepareContainerAuthEnv(config);
    expect(env['GH_TOKEN']).toBe('github_pat_test');
  });

  it('includes managed git identity env when identity is provided', () => {
    const config = createDefaultConfig();
    config.github.token = 'github_pat_test';
    const env = prepareContainerAuthEnv(config, {
      name: 'josheverett',
      email: '151150+josheverett@users.noreply.github.com',
    });

    expect(env['GIT_AUTHOR_NAME']).toBe('josheverett');
    expect(env['GIT_AUTHOR_EMAIL']).toBe('151150+josheverett@users.noreply.github.com');
    expect(env['GIT_COMMITTER_NAME']).toBe('josheverett');
    expect(env['GIT_COMMITTER_EMAIL']).toBe('151150+josheverett@users.noreply.github.com');
    expect(env['GH_TOKEN']).toBe('github_pat_test');
    expect(env['GIT_CONFIG_KEY_2']).toBe('http.https://github.com/.extraheader');
  });

  it('does not include GH_TOKEN when no GitHub token is configured', () => {
    const config = createDefaultConfig();
    const env = prepareContainerAuthEnv(config);
    expect(env['GH_TOKEN']).toBeUndefined();
  });
});
