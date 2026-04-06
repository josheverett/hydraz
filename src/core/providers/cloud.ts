import { LocalContainerProvider } from './local-container.js';

export class CloudProvider extends LocalContainerProvider {
  readonly type = 'cloud' as const;
}
