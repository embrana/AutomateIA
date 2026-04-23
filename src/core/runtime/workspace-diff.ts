import { execFile } from 'child_process';
import { promises as fs } from 'fs';
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

export async function inspectWorkspaceDiffWithExclusions(
  projectRoot: string,
  excludedPrefixes: string[]
): Promise<WorkspaceDiffInspection> {
  try {
    const { stdout: gitRootRaw } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    const gitRoot = gitRootRaw.trim();
    const { stdout: statusRaw } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: gitRoot,
      encoding: 'utf8',
    });
    const rawEntries = statusRaw
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2).trim();
        const rawPath = line.slice(3).split(' -> ').at(-1)?.trim() ?? '';
        const file = rawPath.split(path.sep).join('/');
        const changeType: WorkspaceDiffEntry['changeType'] =
          status === '??' || status.startsWith('A')
            ? 'created'
            : status.startsWith('D')
              ? 'deleted'
              : 'modified';
        return { file, changeType, status };
      });
    const entries = rawEntries.filter((entry) => entry.file && !isExcludedPath(entry.file, excludedPrefixes));

    const { stdout: numstatRaw } = await execFileAsync('git', ['diff', '--numstat', '--'], {
      cwd: gitRoot,
      encoding: 'utf8',
    });
    const trackedTotals = numstatRaw
      .split('\n')
      .filter(Boolean)
      .reduce(
        (sum, line) => {
          const [added, removed, file] = line.split('\t');
          if (!file || isExcludedPath(file, excludedPrefixes)) {
            return sum;
          }
          return {
            added: sum.added + (Number.parseInt(added, 10) || 0),
            removed: sum.removed + (Number.parseInt(removed, 10) || 0),
          };
        },
        { added: 0, removed: 0 }
      );
    const untrackedFiles = entries.filter((entry) => entry.status === '??').map((entry) => entry.file);
    const untrackedAdded = await estimateUntrackedLines(gitRoot, untrackedFiles);
    const addedLines = trackedTotals.added + untrackedAdded;
    const removedLines = trackedTotals.removed;

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

export async function inspectWorkspaceDiff(projectRoot: string): Promise<WorkspaceDiffInspection> {
  return inspectWorkspaceDiffWithExclusions(projectRoot, ['.openspec/']);
}
