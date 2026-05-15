import { promises as fs } from 'fs';
import path from 'path';
import type { TimerSession } from './types.js';

export const TIMER_DIR_NAME = '.openspec';
export const SESSION_FILE_NAME = 'session.json';
export const SESSIONS_DIR_NAME = 'sessions';
export const LOGS_DIR_NAME = 'logs';

export function getTimerDir(projectDir = process.cwd()): string {
  return path.join(projectDir, TIMER_DIR_NAME);
}

export function getSessionPath(projectDir = process.cwd()): string {
  return path.join(getTimerDir(projectDir), SESSION_FILE_NAME);
}

export function getSessionsDir(projectDir = process.cwd()): string {
  return path.join(getTimerDir(projectDir), SESSIONS_DIR_NAME);
}

export function getLogsDir(projectDir = process.cwd()): string {
  return path.join(getTimerDir(projectDir), LOGS_DIR_NAME);
}

export async function ensureTimerDirs(projectDir = process.cwd()): Promise<void> {
  await fs.mkdir(getSessionsDir(projectDir), { recursive: true });
  await fs.mkdir(getLogsDir(projectDir), { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

export async function getActiveSession(projectDir = process.cwd()): Promise<TimerSession | null> {
  return readJson<TimerSession>(getSessionPath(projectDir));
}

export async function saveActiveSession(session: TimerSession, projectDir = process.cwd()): Promise<void> {
  await ensureTimerDirs(projectDir);
  await writeJson(getSessionPath(projectDir), session);
}

export async function clearActiveSession(projectDir = process.cwd()): Promise<void> {
  try {
    await fs.unlink(getSessionPath(projectDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function archiveSession(session: TimerSession, projectDir = process.cwd()): Promise<string> {
  await ensureTimerDirs(projectDir);
  const started = session.started_at.replace(/[:.]/g, '-');
  const filename = `${started}_${session.jira_issue_key}.json`;
  const archivePath = path.join(getSessionsDir(projectDir), filename);
  await writeJson(archivePath, session);
  return archivePath;
}

export async function listArchivedSessions(projectDir = process.cwd()): Promise<TimerSession[]> {
  try {
    const entries = await fs.readdir(getSessionsDir(projectDir), { withFileTypes: true });
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => readJson<TimerSession>(path.join(getSessionsDir(projectDir), entry.name)))
    );

    return sessions
      .filter((session): session is TimerSession => session !== null)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
