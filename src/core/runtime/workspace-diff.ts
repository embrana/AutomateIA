import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface WorkspaceDiffEntry {
  file: string;
  changeType: 'modified' | 'created' | 'deleted';
}

export interface WorkspaceDiffInspection {
  changes: WorkspaceDiffEntry[];
  diffLines: number;
  addedLines: number;
  removedLines: number;
  source: 'git' | 'fallback';
}

interface GitStatusEntry extends WorkspaceDiffEntry {
  status: string;
}

interface WorkspaceDiffFileStats {
  added: number;
  removed: number;
}

interface WorkspaceDiffBaselineEntry {
  file: string;
  snapshotPath: string;
  existed: boolean;
}

export interface WorkspaceDiffBaseline {
  gitRoot: string;
  tempDir: string;
  entries: Record<string, WorkspaceDiffBaselineEntry>;
}

async function estimateUntrackedLines(projectRoot: string, files: string[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(projectRoot, file), 'utf-8');
      total += raw.split('\n').length;
    } catch {
      total += 0;
    }
  }
  return total;
}

function isExcludedPath(file: string, excludedPrefixes: string[]): boolean {
  return excludedPrefixes.some((prefix) => file.startsWith(prefix));
}

async function resolveGitRoot(projectRoot: string): Promise<string> {
  const { stdout: gitRootRaw } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return gitRootRaw.trim();
}

function toWorkspaceChangeType(status: string): WorkspaceDiffEntry['changeType'] {
  return status === '??' || status.startsWith('A')
    ? 'created'
    : status.startsWith('D')
      ? 'deleted'
      : 'modified';
}

async function listGitStatusEntries(
  gitRoot: string,
  excludedPrefixes: string[]
): Promise<GitStatusEntry[]> {
  const { stdout: statusRaw } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: gitRoot,
    encoding: 'utf8',
  });
  return statusRaw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const rawPath = line.slice(3).split(' -> ').at(-1)?.trim() ?? '';
      const file = rawPath.split(path.sep).join('/');
      return {
        file,
        changeType: toWorkspaceChangeType(status),
        status,
      };
    })
    .filter((entry) => entry.file && !isExcludedPath(entry.file, excludedPrefixes));
}

async function listGitDiffStatsByFile(
  gitRoot: string,
  entries: GitStatusEntry[],
  excludedPrefixes: string[]
): Promise<Map<string, WorkspaceDiffFileStats>> {
  const stats = new Map<string, WorkspaceDiffFileStats>();
  const { stdout: numstatRaw } = await execFileAsync('git', ['diff', '--numstat', '--'], {
    cwd: gitRoot,
    encoding: 'utf8',
  });
  for (const line of numstatRaw.split('\n').filter(Boolean)) {
    const [added, removed, file] = line.split('\t');
    if (!file || isExcludedPath(file, excludedPrefixes)) {
      continue;
    }
    stats.set(file, {
      added: Number.parseInt(added, 10) || 0,
      removed: Number.parseInt(removed, 10) || 0,
    });
  }

  const untrackedFiles = entries.filter((entry) => entry.status === '??').map((entry) => entry.file);
  for (const file of untrackedFiles) {
    stats.set(file, {
      added: await estimateUntrackedLines(gitRoot, [file]),
      removed: 0,
    });
  }

  return stats;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function filesAreEqual(leftPath: string, rightPath: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    fs.readFile(leftPath),
    fs.readFile(rightPath),
  ]);
  return left.equals(right);
}

async function countLines(filePath: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.split('\n').length;
  } catch {
    return 0;
  }
}

async function diffStatsBetweenFiles(
  leftPath: string,
  rightPath: string
): Promise<WorkspaceDiffFileStats> {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('git', ['diff', '--no-index', '--numstat', '--', leftPath, rightPath], {
      encoding: 'utf8',
    }));
  } catch (error) {
    const candidate = error as { stdout?: string; code?: number };
    if (candidate.code !== 1 || typeof candidate.stdout !== 'string') {
      throw error;
    }
    stdout = candidate.stdout;
  }
  const line = stdout.split('\n').find(Boolean);
  if (!line) {
    return { added: 0, removed: 0 };
  }
  const [added, removed] = line.split('\t');
  return {
    added: Number.parseInt(added, 10) || 0,
    removed: Number.parseInt(removed, 10) || 0,
  };
}

async function inspectWorkspaceDiffInternal(
  projectRoot: string,
  excludedPrefixes: string[]
): Promise<{
  gitRoot: string;
  entries: GitStatusEntry[];
  statsByFile: Map<string, WorkspaceDiffFileStats>;
}> {
  const gitRoot = await resolveGitRoot(projectRoot);
  const entries = await listGitStatusEntries(gitRoot, excludedPrefixes);
  const statsByFile = await listGitDiffStatsByFile(gitRoot, entries, excludedPrefixes);
  return { gitRoot, entries, statsByFile };
}

export async function captureWorkspaceDiffBaseline(
  projectRoot: string,
  excludedPrefixes: string[]
): Promise<WorkspaceDiffBaseline | null> {
  try {
    const { gitRoot, entries } = await inspectWorkspaceDiffInternal(projectRoot, excludedPrefixes);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-workspace-baseline-'));
    const baselineEntries: Record<string, WorkspaceDiffBaselineEntry> = {};

    for (const entry of entries) {
      const sourcePath = path.join(gitRoot, entry.file);
      const snapshotPath = path.join(tempDir, entry.file);
      const existed = await fileExists(sourcePath);
      if (existed) {
        await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
        await fs.copyFile(sourcePath, snapshotPath);
      }
      baselineEntries[entry.file] = {
        file: entry.file,
        snapshotPath,
        existed,
      };
    }

    return {
      gitRoot,
      tempDir,
      entries: baselineEntries,
    };
  } catch {
    return null;
  }
}

export async function disposeWorkspaceDiffBaseline(baseline: WorkspaceDiffBaseline | null): Promise<void> {
  if (!baseline) {
    return;
  }
  await fs.rm(baseline.tempDir, { recursive: true, force: true });
}

export async function inspectWorkspaceDiffWithExclusions(
  projectRoot: string,
  excludedPrefixes: string[]
): Promise<WorkspaceDiffInspection> {
  try {
    const { gitRoot, entries, statsByFile } = await inspectWorkspaceDiffInternal(projectRoot, excludedPrefixes);
    let addedLines = 0;
    let removedLines = 0;
    for (const stats of statsByFile.values()) {
      addedLines += stats.added;
      removedLines += stats.removed;
    }

    return {
      changes: entries.map(({ file, changeType }) => ({ file, changeType })),
      diffLines: addedLines + removedLines,
      addedLines,
      removedLines,
      source: 'git',
    };
  } catch {
    return {
      changes: [],
      diffLines: 0,
      addedLines: 0,
      removedLines: 0,
      source: 'fallback',
    };
  }
}

export async function inspectWorkspaceDiffSinceBaseline(
  projectRoot: string,
  excludedPrefixes: string[],
  baseline: WorkspaceDiffBaseline | null
): Promise<WorkspaceDiffInspection> {
  if (!baseline) {
    return inspectWorkspaceDiffWithExclusions(projectRoot, excludedPrefixes);
  }

  try {
    const { gitRoot, entries, statsByFile } = await inspectWorkspaceDiffInternal(projectRoot, excludedPrefixes);
    const postEntryMap = new Map(entries.map((entry) => [entry.file, entry]));
    const touched = new Map<string, WorkspaceDiffEntry>();
    let addedLines = 0;
    let removedLines = 0;

    for (const entry of entries) {
      if (baseline.entries[entry.file]) {
        continue;
      }
      const stats = statsByFile.get(entry.file) ?? { added: 0, removed: 0 };
      touched.set(entry.file, { file: entry.file, changeType: entry.changeType });
      addedLines += stats.added;
      removedLines += stats.removed;
    }

    for (const baselineEntry of Object.values(baseline.entries)) {
      const currentPath = path.join(gitRoot, baselineEntry.file);
      const existsNow = await fileExists(currentPath);
      const changedSinceBaseline = baselineEntry.existed !== existsNow
        || (baselineEntry.existed && existsNow && !(await filesAreEqual(baselineEntry.snapshotPath, currentPath)));
      if (!changedSinceBaseline) {
        continue;
      }

      const changeType: WorkspaceDiffEntry['changeType'] = baselineEntry.existed
        ? existsNow ? 'modified' : 'deleted'
        : existsNow ? 'modified' : 'deleted';
      const stats = baselineEntry.existed
        ? existsNow
          ? await diffStatsBetweenFiles(baselineEntry.snapshotPath, currentPath)
          : { added: 0, removed: await countLines(baselineEntry.snapshotPath) }
        : existsNow
          ? { added: await countLines(currentPath), removed: 0 }
          : { added: 0, removed: 0 };

      touched.set(baselineEntry.file, { file: baselineEntry.file, changeType });
      addedLines += stats.added;
      removedLines += stats.removed;

      if (!existsNow && !postEntryMap.has(baselineEntry.file)) {
        postEntryMap.set(baselineEntry.file, {
          file: baselineEntry.file,
          changeType,
          status: 'D',
        });
      }
    }

    return {
      changes: Array.from(touched.values()).sort((left, right) => left.file.localeCompare(right.file)),
      diffLines: addedLines + removedLines,
      addedLines,
      removedLines,
      source: 'git',
    };
  } catch {
    return inspectWorkspaceDiffWithExclusions(projectRoot, excludedPrefixes);
  }
}

export async function inspectWorkspaceDiff(projectRoot: string): Promise<WorkspaceDiffInspection> {
  return inspectWorkspaceDiffWithExclusions(projectRoot, ['.openspec/']);
}
