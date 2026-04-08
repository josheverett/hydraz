export function artifactPath(swarmDir: string | undefined, ...segments: string[]): string {
  const base = swarmDir ?? 'swarm';
  return [base, ...segments].join('/');
}
