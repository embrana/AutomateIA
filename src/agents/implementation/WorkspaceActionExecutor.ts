import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WorkspaceAction =
  | {
      type: 'write_file';
      path: string;
      content: string;
      create_only?: boolean;
    }
  | {
      type: 'replace_in_file';
      path: string;
      old: string;
      new: string;
    }
  | {
      type: 'delete_file';
      path: string;
    }
  | {
      type: 'run_command';
      command: string[];
      reason?: string;
    };

export interface WorkspaceCommandResult {
  command: string[];
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface WorkspaceExecutionSummary {
  status: 'NOT_REQUESTED' | 'APPLIED' | 'BLOCKED' | 'FAILED';
  applied_actions: number;
  blocked_actions: number;
  file_actions: number;
  command_actions: number;
  touched_files: string[];
  command_results: WorkspaceCommandResult[];
  errors: string[];
}

export interface WorkspaceActionExecutionOptions {
  projectRoot: string;
  changeName: string;
  allowedCommandPrefixes?: string[][];
}

function truncateOutput(value: string, limit = 4000): string {
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated]` : value;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function matchesAllowedPrefix(command: string[], allowedPrefixes: string[][]): boolean {
  return allowedPrefixes.some((prefix) => prefix.every((part, index) => command[index] === part));
}

export function parseWorkspaceActions(value: unknown): WorkspaceAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): WorkspaceAction[] => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const action = item as Record<string, unknown>;
    switch (action.type) {
      case 'write_file':
        if (typeof action.path === 'string' && typeof action.content === 'string') {
          return [{
            type: 'write_file',
            path: action.path,
            content: action.content,
            create_only: action.create_only === true,
          }];
        }
        return [];
      case 'replace_in_file':
        if (
          typeof action.path === 'string'
          && typeof action.old === 'string'
          && typeof action.new === 'string'
        ) {
          return [{
            type: 'replace_in_file',
            path: action.path,
            old: action.old,
            new: action.new,
          }];
        }
        return [];
      case 'delete_file':
        if (typeof action.path === 'string') {
          return [{
            type: 'delete_file',
            path: action.path,
          }];
        }
        return [];
      case 'run_command':
        if (Array.isArray(action.command) && action.command.every((part) => typeof part === 'string')) {
          return [{
            type: 'run_command',
            command: action.command as string[],
            reason: typeof action.reason === 'string' ? action.reason : undefined,
          }];
        }
        return [];
      default:
        return [];
    }
  });
}

function defaultAllowedCommandPrefixes(): string[][] {
  return [
    ['pnpm', 'exec', 'vitest'],
    ['pnpm', 'test'],
    ['pnpm', 'run', 'test'],
    ['pnpm', 'exec', 'tsc'],
    ['npm', 'test'],
    ['npm', 'run', 'test'],
    ['yarn', 'test'],
    ['node', '--test'],
  ];
}

export class WorkspaceActionExecutor {
  private readonly allowedCommandPrefixes: string[][];

  constructor(private readonly options: WorkspaceActionExecutionOptions) {
    this.allowedCommandPrefixes = options.allowedCommandPrefixes ?? defaultAllowedCommandPrefixes();
  }

  getTargetedFiles(actions: WorkspaceAction[]): string[] {
    return [...new Set(actions
      .filter((action) => action.type !== 'run_command')
      .map((action) => normalizeRelativePath(action.path)))];
  }

  async execute(actions: WorkspaceAction[]): Promise<WorkspaceExecutionSummary> {
    if (actions.length === 0) {
      return {
        status: 'NOT_REQUESTED',
        applied_actions: 0,
        blocked_actions: 0,
        file_actions: 0,
        command_actions: 0,
        touched_files: [],
        command_results: [],
        errors: [],
      };
    }

    const touchedFiles = new Set<string>();
    const commandResults: WorkspaceCommandResult[] = [];
    const errors: string[] = [];
    let appliedActions = 0;
    let blockedActions = 0;
    let fileActions = 0;
    let commandActions = 0;

    for (const action of actions) {
      try {
        if (action.type === 'run_command') {
          commandActions += 1;
          if (!matchesAllowedPrefix(action.command, this.allowedCommandPrefixes)) {
            blockedActions += 1;
            errors.push(`Blocked command: ${action.command.join(' ')}`);
            continue;
          }
          const result = await execFileAsync(action.command[0], action.command.slice(1), {
            cwd: this.options.projectRoot,
            encoding: 'utf8',
          });
          commandResults.push({
            command: action.command,
            exit_code: 0,
            stdout: truncateOutput(result.stdout),
            stderr: truncateOutput(result.stderr),
          });
          appliedActions += 1;
          continue;
        }

        fileActions += 1;
        const resolvedPath = this.resolveWritablePath(action.path);
        const relativePath = normalizeRelativePath(path.relative(this.options.projectRoot, resolvedPath));

        if (action.type === 'write_file') {
          if (action.create_only) {
            try {
              await fs.access(resolvedPath);
              throw new Error(`Refused to overwrite existing file ${relativePath} with create_only=true.`);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
              }
            }
          }
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, action.content, 'utf-8');
        } else if (action.type === 'replace_in_file') {
          const current = await fs.readFile(resolvedPath, 'utf-8');
          if (!current.includes(action.old)) {
            throw new Error(`Could not find requested replacement target in ${relativePath}.`);
          }
          await fs.writeFile(resolvedPath, current.replace(action.old, action.new), 'utf-8');
        } else {
          await fs.rm(resolvedPath, { force: true });
        }

        touchedFiles.add(relativePath);
        appliedActions += 1;
      } catch (error) {
        blockedActions += 1;
        if (action.type === 'run_command') {
          const command = action.command.join(' ');
          errors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
        } else {
          errors.push(`${action.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return {
      status: errors.length > 0 ? 'FAILED' : 'APPLIED',
      applied_actions: appliedActions,
      blocked_actions: blockedActions,
      file_actions: fileActions,
      command_actions: commandActions,
      touched_files: [...touchedFiles],
      command_results: commandResults,
      errors,
    };
  }

  private resolveWritablePath(relativePath: string): string {
    const normalized = normalizeRelativePath(relativePath);
    const resolved = path.resolve(this.options.projectRoot, normalized);
    const relativeToRoot = normalizeRelativePath(path.relative(this.options.projectRoot, resolved));

    if (relativeToRoot.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Path "${relativePath}" is outside the project root.`);
    }
    if (relativeToRoot.startsWith('.git/')) {
      throw new Error(`Path "${relativePath}" is inside .git and is not writable by the runtime.`);
    }
    if (relativeToRoot.startsWith('.openspec/runtime/')) {
      throw new Error(`Path "${relativePath}" is inside runtime artifacts and is not writable by ImplementationAgent.`);
    }
    if (relativeToRoot.startsWith(`openspec/changes/${this.options.changeName}/`)) {
      throw new Error(`Path "${relativePath}" is inside the active OpenSpec change scaffold and is not writable by ImplementationAgent.`);
    }

    return resolved;
  }
}
