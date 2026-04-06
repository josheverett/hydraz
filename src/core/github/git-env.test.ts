import { describe, it, expect } from 'vitest';
import { buildGitHubGitEnv } from './git-env.js';

describe('buildGitHubGitEnv', () => {
  it('disables interactive git prompts', () => {
    const env = buildGitHubGitEnv('github_pat_test');
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
  });

  it('rewrites GitHub SSH remotes to HTTPS', () => {
    const env = buildGitHubGitEnv('github_pat_test');
    expect(env['GIT_CONFIG_COUNT']).toBe('3');
    expect(env['GIT_CONFIG_KEY_0']).toBe('url.https://github.com/.insteadof');
    expect(env['GIT_CONFIG_VALUE_0']).toBe('git@github.com:');
    expect(env['GIT_CONFIG_KEY_1']).toBe('url.https://github.com/.insteadof');
    expect(env['GIT_CONFIG_VALUE_1']).toBe('ssh://git@github.com/');
  });

  it('injects an HTTP authorization header for github.com', () => {
    const env = buildGitHubGitEnv('github_pat_test');
    expect(env['GIT_CONFIG_KEY_2']).toBe('http.https://github.com/.extraheader');
    expect(env['GIT_CONFIG_VALUE_2']).toBe(
      `AUTHORIZATION: basic ${Buffer.from('x-access-token:github_pat_test').toString('base64')}`,
    );
  });
});
