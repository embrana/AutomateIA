import fs from 'fs';
import path from 'path';
import { getGlobalConfig, type GlobalConfig } from '../global-config.js';
import { getTimerDir } from './store.js';

export const TIMER_CONFIG_FILE_NAME = 'config.json';

function mergeTimerConfig(globalConfig: GlobalConfig, localConfig: Partial<GlobalConfig>): GlobalConfig {
  return {
    ...globalConfig,
    ...localConfig,
    jira: {
      ...(globalConfig.jira || {}),
      ...(localConfig.jira || {}),
    },
    worklog: {
      ...(globalConfig.worklog || {}),
      ...(localConfig.worklog || {}),
    },
  };
}

export function getLocalTimerConfigPath(projectDir = process.cwd()): string {
  return path.join(getTimerDir(projectDir), TIMER_CONFIG_FILE_NAME);
}

export function getTimerConfig(projectDir = process.cwd()): GlobalConfig {
  const globalConfig = getGlobalConfig();
  const localConfigPath = getLocalTimerConfigPath(projectDir);

  if (!fs.existsSync(localConfigPath)) {
    return globalConfig;
  }

  try {
    const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8')) as Partial<GlobalConfig>;
    return mergeTimerConfig(globalConfig, localConfig);
  } catch (error) {
    throw new Error(
      `Invalid OpenSpec timer config at ${localConfigPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
