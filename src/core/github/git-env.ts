export function buildGitHubGitEnv(token: string): Record<string, string> {
  const basicAuth = Buffer.from(`x-access-token:${token}`, 'utf-8').toString('base64');

  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadof',
    GIT_CONFIG_VALUE_0: 'git@github.com:',
    GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadof',
    GIT_CONFIG_VALUE_1: 'ssh://git@github.com/',
    GIT_CONFIG_KEY_2: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_2: `AUTHORIZATION: basic ${basicAuth}`,
  };
}
