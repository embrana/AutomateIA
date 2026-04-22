import { promises as fs } from 'fs';
import path from 'path';
import type { TimerSession } from '../core/timer/types.js';

export interface ArchiveRoutingDecision {
  targetChangeName?: string;
  fallBackToTimerArchive: boolean;
  warning?: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveArchiveRouting(params: {
  projectRoot?: string;
  explicitChangeName?: string;
  timerSession?: TimerSession | null;
}): Promise<ArchiveRoutingDecision> {
  const projectRoot = params.projectRoot ?? process.cwd();
  const timerSession = params.timerSession ?? null;
  let targetChangeName = params.explicitChangeName ?? timerSession?.openspec_change?.name;

  if (!timerSession) {
    return {
      targetChangeName,
      fallBackToTimerArchive: false,
    };
  }

  if (params.explicitChangeName) {
    return {
      targetChangeName,
      fallBackToTimerArchive: false,
    };
  }

  if (!targetChangeName) {
    return {
      targetChangeName: undefined,
      fallBackToTimerArchive: true,
    };
  }

  const configuredPath = timerSession.openspec_change?.path;
  const expectedPath = path.join(projectRoot, 'openspec', 'changes', targetChangeName);
  const candidatePaths = [configuredPath, expectedPath].filter((value): value is string => Boolean(value));
  const existingPath = await Promise.all(candidatePaths.map(async (candidate) => ({ candidate, exists: await pathExists(candidate) })));

  if (existingPath.some((entry) => entry.exists)) {
    return {
      targetChangeName,
      fallBackToTimerArchive: false,
    };
  }

  return {
    targetChangeName: undefined,
    fallBackToTimerArchive: true,
    warning: `Active timer references missing change '${targetChangeName}'. Falling back to Jira worklog archive only.`,
  };
}
