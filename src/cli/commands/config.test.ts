import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { input, select } from '@inquirer/prompts';
import { createDefaultConfig } from '../../core/config/schema.js';
import { loadConfig, saveConfig } from '../../core/config/index.js';
import { configMenu } from './config.js';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
}));

vi.mock('../../core/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/config/index.js')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    configExists: vi.fn(),
    initializeConfigDir: vi.fn(),
  };
});

describe('configMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(select).mockReset();
    vi.mocked(input).mockReset();
    vi.mocked(loadConfig).mockReturnValue(createDefaultConfig());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the managed Codex model settings', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('view')
      .mockResolvedValueOnce('exit');

    await configMenu();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Codex model:       gpt-5.6-sol');
    expect(output).toContain('Codex reasoning:   ultra');
    expect(output).toContain('Codex speed:       fast');
  });

  it('sets the Codex reasoning effort', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('codex-reasoning-effort')
      .mockResolvedValueOnce('high')
      .mockResolvedValueOnce('exit');

    await configMenu();

    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      codex: expect.objectContaining({ reasoningEffort: 'high' }),
    }));
  });

  it('sets the Codex speed', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('codex-speed')
      .mockResolvedValueOnce('standard')
      .mockResolvedValueOnce('exit');

    await configMenu();

    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      codex: expect.objectContaining({ speed: 'standard' }),
    }));
  });

  it('resets a blank model to the Hydraz default', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('codex-model')
      .mockResolvedValueOnce('exit');
    vi.mocked(input).mockResolvedValue('');

    await configMenu();

    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      codex: expect.objectContaining({ model: 'gpt-5.6-sol' }),
    }));
  });
});
