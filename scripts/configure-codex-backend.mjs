#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function getGlobalConfigPath() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'openspec', 'config.json');
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'openspec', 'config.json');
  }

  return path.join(os.homedir(), '.config', 'openspec', 'config.json');
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function loadConfig(configPath) {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function main() {
  const configPath = getGlobalConfigPath();
  const configDir = path.dirname(configPath);
  const current = ensureObject(await loadConfig(configPath));

  const agents = ensureObject(current.agents);
  const routing = ensureObject(agents.routing);
  const backends = ensureObject(agents.backends);
  const backendName = 'codex-cli';

  backends[backendName] = {
    ...ensureObject(backends[backendName]),
    mode: 'command',
    command: 'node',
    args: ['scripts/codex-implementation-runner.mjs'],
    sandbox_mode: 'workspace-write',
    implementation_mode: 'direct_edit',
    timeout_ms: 900000,
  };
  routing.implementation = backendName;

  const nextConfig = {
    ...current,
    agents: {
      ...agents,
      routing,
      backends,
    },
  };

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(nextConfig, null, 2) + '\n', 'utf-8');

  process.stdout.write(`${JSON.stringify({
    config_path: configPath,
    backend_name: backendName,
    route: 'implementation',
    command: 'node scripts/codex-implementation-runner.mjs',
    sandbox_mode: 'workspace-write',
    implementation_mode: 'direct_edit',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
