import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCodexContainerImportPlan,
  resolveHostCodexHome,
} from './container-import.js';

let repoRoot: string;
let codexHome: string;

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'hydraz-container-import-repo-'));
  codexHome = mkdtempSync(join(tmpdir(), 'hydraz-container-import-home-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

describe('buildCodexContainerImportPlan', () => {
  it('resolves CODEX_HOME from the environment with a home-directory fallback', () => {
    expect(resolveHostCodexHome({ CODEX_HOME: '/tmp/custom-codex' }, '/home/codex')).toBe(
      '/tmp/custom-codex',
    );
    expect(resolveHostCodexHome({}, '/home/codex')).toBe('/home/codex/.codex');
  });

  it('discovers only existing critical files and directories', () => {
    writeFile(join(codexHome, 'auth.json'), '{}\n');
    writeFile(join(codexHome, 'AGENTS.md'), '# Instructions\n');
    mkdirSync(join(codexHome, 'rules'), { recursive: true });
    mkdirSync(join(codexHome, 'skills'), { recursive: true });
    mkdirSync(join(codexHome, 'plugins'), { recursive: true });

    const plan = buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    });

    expect(plan.files).toEqual([
      { sourcePath: join(codexHome, 'auth.json'), targetRelativePath: 'auth.json' },
      { sourcePath: join(codexHome, 'AGENTS.md'), targetRelativePath: 'AGENTS.md' },
    ]);
    expect(plan.directories).toEqual([
      {
        sourcePath: join(codexHome, 'rules'),
        targetRelativePath: 'rules',
        excludedDirectoryNames: [],
      },
      {
        sourcePath: join(codexHome, 'skills'),
        targetRelativePath: 'skills',
        excludedDirectoryNames: ['.system', 'node_modules', '.venv', 'venv'],
      },
    ]);
  });

  it('does not misclassify files and directories with critical input names', () => {
    mkdirSync(join(codexHome, 'auth.json'), { recursive: true });
    mkdirSync(join(codexHome, 'AGENTS.md'), { recursive: true });
    writeFile(join(codexHome, 'rules'), 'not a directory\n');
    writeFile(join(codexHome, 'skills'), 'not a directory\n');

    const plan = buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    });

    expect(plan.files).toEqual([]);
    expect(plan.directories).toEqual([]);
  });

  it('selects only portable host configuration', () => {
    writeFile(join(codexHome, 'config.toml'), `
model = "gpt-5.6"
model_reasoning_effort = "high"
model_reasoning_summary = "detailed"
model_supports_reasoning_summaries = true
plan_mode_reasoning_effort = "medium"
model_verbosity = "low"
personality = "pragmatic"
service_tier = "fast"
web_search = "live"
project_doc_max_bytes = 1234
project_doc_fallback_filenames = ["AGENT.md"]
notify = ["/Applications/Notifier.app/notify"]

[tools]
view_image = true
web_search = { context_size = "high" }

[features]
multi_agent = true

[projects."/Users/josh/repo"]
trust_level = "trusted"

[mcp_servers.host_only]
command = "/Applications/tool"
`);

    const plan = buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    });

    expect(parse(plan.configToml ?? '')).toEqual({
      model: 'gpt-5.6',
      model_reasoning_effort: 'high',
      model_reasoning_summary: 'detailed',
      model_supports_reasoning_summaries: true,
      plan_mode_reasoning_effort: 'medium',
      model_verbosity: 'low',
      personality: 'pragmatic',
      service_tier: 'fast',
      web_search: 'live',
      project_doc_max_bytes: 1234,
      project_doc_fallback_filenames: ['AGENT.md'],
      tools: {
        view_image: true,
        web_search: { context_size: 'high' },
      },
    });
  });

  it('recursively applies the conventional Linux overlay and replaces arrays and scalars', () => {
    writeFile(join(codexHome, 'config.toml'), `
model = "host-model"
project_doc_fallback_filenames = ["HOST.md"]
[tools]
view_image = true
web_search = { context_size = "low" }
`);
    writeFile(join(repoRoot, '.hydraz', 'codex.container.toml'), `
model = "container-model"
project_doc_fallback_filenames = ["CONTAINER.md"]
[tools]
view_image = false
[mcp_servers.playwright]
command = "pnpm"
args = ["--dir", "codex-browser-runtime", "run", "mcp"]
`);

    const plan = buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    });

    expect(parse(plan.configToml ?? '')).toEqual({
      model: 'container-model',
      project_doc_fallback_filenames: ['CONTAINER.md'],
      tools: {
        view_image: false,
        web_search: { context_size: 'low' },
      },
      mcp_servers: {
        playwright: {
          command: 'pnpm',
          args: ['--dir', 'codex-browser-runtime', 'run', 'mcp'],
        },
      },
    });
  });

  it('uses the conventional overlay when the host has no config', () => {
    writeFile(join(repoRoot, '.hydraz', 'codex.container.toml'), 'model = "container-model"\n');

    const plan = buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    });

    expect(parse(plan.configToml ?? '')).toEqual({ model: 'container-model' });
  });

  it('rejects macOS path signatures anywhere in the generated config', () => {
    for (const signature of ['/Users/josh/tool', '/Applications/Tool.app', '~/Library/Caches/tool']) {
      writeFile(
        join(repoRoot, '.hydraz', 'codex.container.toml'),
        `[mcp_servers.example]\ncommand = ${JSON.stringify(signature)}\n`,
      );
      expect(() => buildCodexContainerImportPlan(repoRoot, {
        env: { CODEX_HOME: codexHome },
      })).toThrow(/macOS path.*mcp_servers\.example\.command/i);
    }

    writeFile(
      join(repoRoot, '.hydraz', 'codex.container.toml'),
      '[projects."/Users/josh/repo"]\ntrust_level = "trusted"\n',
    );
    expect(() => buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    })).toThrow(/macOS path.*projects.*\/Users\/josh\/repo/i);
  });

  it('fails on malformed host TOML instead of silently dropping it', () => {
    writeFile(join(codexHome, 'config.toml'), 'model = [\n');

    expect(() => buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    })).toThrow(/config\.toml.*invalid TOML/i);
  });

  it('fails on malformed overlay TOML instead of silently dropping it', () => {
    writeFile(join(repoRoot, '.hydraz', 'codex.container.toml'), 'model = [\n');

    expect(() => buildCodexContainerImportPlan(repoRoot, {
      env: { CODEX_HOME: codexHome },
    })).toThrow(/codex\.container\.toml.*invalid TOML/i);
  });
});
