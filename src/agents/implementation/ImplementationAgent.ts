import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { getTaskProgressForChange } from '../../utils/task-progress.js';
import { AutonomyPolicy } from '../../core/runtime/orchestration/AutonomyPolicy.js';
import { AgentBackendRegistry } from '../../core/runtime/agent-backends/BackendRegistry.js';
import type { AgentInvocationResult } from '../../core/runtime/agent-backends/types.js';
import type { AgentBackendMode } from '../../core/runtime/agent-backends/config.js';
import {
  parseWorkspaceActions,
  WorkspaceActionExecutor,
  type WorkspaceExecutionSummary,
} from './WorkspaceActionExecutor.js';
import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';
import type { ExecutionPlan } from '../planning/PlanningAgent.js';

const execFileAsync = promisify(execFile);

export interface ImplementationChange {
  file: string;
  change_type: 'modified' | 'created' | 'deleted';
  summary: string;
}

export interface ImplementationScopeAssessment {
  changed_files_count: number;
  diff_lines: number;
  high_risk_files: string[];
  requires_human_approval: boolean;
  policy_reasons: string[];
}

export interface ImplementationAgentInput {
  normalized_context: NormalizedContext;
  execution_plan: ExecutionPlan;
}

export interface ImplementationAgentOutput {
  changes_applied: ImplementationChange[];
  tasks_completed: string[];
  tasks_remaining: string[];
  tests_added: string[];
  known_limitations: string[];
  scope_assessment: ImplementationScopeAssessment;
  backend_invocation: ImplementationBackendInvocation;
  workspace_execution: WorkspaceExecutionSummary;
}

export interface ImplementationBackendInvocation {
  configured: boolean;
  backend_name?: string;
  mode: AgentBackendMode | 'none';
  status: 'NOT_CONFIGURED' | 'PREPARED' | 'EXECUTED' | 'FAILED';
  system_prompt?: string;
  task_prompt?: string;
  request_payload?: Record<string, unknown>;
  response_payload?: unknown;
  structured_output?: Record<string, unknown> | null;
  notes: string[];
  error?: string;
  proposed_workspace_actions?: ReturnType<typeof parseWorkspaceActions>;
}

function isTestFile(file: string): boolean {
  return /(^test\/|\/test\/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$)/.test(file);
}

function toImplementationSummary(changeType: ImplementationChange['change_type'], file: string): string {
  if (isTestFile(file)) {
    return changeType === 'created' ? 'Added test coverage' : 'Updated test coverage';
  }
  switch (changeType) {
    case 'created':
      return 'Added new implementation file';
    case 'deleted':
      return 'Removed implementation file';
    default:
      return 'Updated implementation file';
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function summarizeDiff(changes: Array<{ file: string; changeType: ImplementationChange['change_type'] }>): string[] {
  return changes.map((entry) => `${entry.changeType}: ${entry.file}`);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

async function loadLikelyAffectedFileContext(
  projectRoot: string,
  executionPlan: ExecutionPlan,
  limit = 4
): Promise<Array<{ path: string; content: string }>> {
  const snippets: Array<{ path: string; content: string }> = [];
  for (const relativePath of executionPlan.files_likely_affected.slice(0, limit)) {
    try {
      const filePath = path.join(projectRoot, relativePath);
      const content = await fs.readFile(filePath, 'utf-8');
      snippets.push({
        path: relativePath,
        content: content.length > 12_000 ? `${content.slice(0, 12_000)}\n...[truncated]` : content,
      });
    } catch {
      // Missing files are fine; the backend can choose to create them.
    }
  }
  return snippets;
}

async function buildImplementationPrompts(
  input: ImplementationAgentInput,
  context: AgentContext,
  diffInspection: {
    changes: Array<{ file: string; changeType: ImplementationChange['change_type'] }>;
    diffLines: number;
    source: 'git' | 'fallback';
  }
): Promise<{ systemPrompt: string; taskPrompt: string; metadata: Record<string, unknown> }> {
  const likelyAffectedFiles = await loadLikelyAffectedFileContext(context.projectRoot, input.execution_plan);
  const systemPrompt = [
    'You are the ImplementationAgent for the OpenSpec agentic runtime.',
    'If your backend can edit the workspace, apply the requested code and test changes within the allowed constraints.',
    'Always return JSON only with keys: status, summary, files_touched, tests_added, limitations, human_questions, workspace_actions.',
    'workspace_actions can contain write_file, replace_in_file, delete_file, and run_command actions.',
    'Use run_command only for focused verification commands such as node --test, pnpm test, vitest, or tsc --noEmit.',
    'If you cannot edit files directly, return the intended edits as workspace_actions so the runtime can apply them locally.',
  ].join(' ');

  const taskPrompt = [
    '# Work Unit',
    `Ticket: ${context.envelope.ticket_key}`,
    `Change: ${context.envelope.change_name ?? '(no active change)'}`,
    '',
    '# Objective',
    input.execution_plan.objective,
    '',
    '# Constraints',
    stringifyJson({
      can_edit_code: context.envelope.constraints.canEditCode,
      max_files_to_edit: context.envelope.constraints.maxFilesToEdit ?? null,
      max_diff_lines: context.envelope.constraints.maxDiffLines ?? null,
      high_risk_paths: context.envelope.constraints.highRiskPaths ?? [],
      retries_remaining: context.envelope.budget?.maxRetriesRemaining ?? null,
    }),
    '',
    '# Normalized Context',
    stringifyJson(input.normalized_context),
    '',
    '# Execution Plan',
    stringifyJson(input.execution_plan),
    '',
    '# Current Workspace Snapshot',
    stringifyJson({
      diff_source: diffInspection.source,
      diff_lines: diffInspection.diffLines,
      changed_files: summarizeDiff(diffInspection.changes),
    }),
    '',
    '# Likely Affected File Contents',
    likelyAffectedFiles.length > 0
      ? likelyAffectedFiles.map((file) => `## ${file.path}\n\`\`\`\n${file.content}\n\`\`\``).join('\n\n')
      : '(No likely-affected files currently exist in the workspace.)',
    '',
    '# Instructions',
    '- Prefer minimal, production-ready edits.',
    '- Update or add tests when the plan requires them.',
    '- Respect high-risk path guards and do not exceed the allowed file/diff budget.',
    '- Return JSON only.',
    '- If you want the runtime to modify files locally, include workspace_actions.',
  ].join('\n');

  return {
    systemPrompt,
    taskPrompt,
    metadata: {
      execution_plan_step_ids: input.execution_plan.steps.map((step) => step.id),
      likely_affected_files: input.execution_plan.files_likely_affected,
      likely_affected_file_context: likelyAffectedFiles,
      input_refs: context.envelope.input_refs,
    },
  };
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

async function inspectWorkspaceDiff(projectRoot: string): Promise<{
  changes: Array<{ file: string; changeType: ImplementationChange['change_type'] }>;
  diffLines: number;
  source: 'git' | 'fallback';
}> {
  return inspectWorkspaceDiffWithExclusions(projectRoot, ['.openspec/']);
}

async function inspectWorkspaceDiffWithExclusions(
  projectRoot: string,
  excludedPrefixes: string[]
): Promise<{
  changes: Array<{ file: string; changeType: ImplementationChange['change_type'] }>;
  diffLines: number;
  source: 'git' | 'fallback';
}> {
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
        const changeType: ImplementationChange['change_type'] =
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
    const trackedDiffLines = numstatRaw
      .split('\n')
      .filter(Boolean)
      .reduce((sum, line) => {
        const [added, removed, file] = line.split('\t');
        if (!file || isExcludedPath(file, excludedPrefixes)) {
          return sum;
        }
        return sum + (Number.parseInt(added, 10) || 0) + (Number.parseInt(removed, 10) || 0);
      }, 0);
    const untrackedFiles = entries.filter((entry) => entry.status === '??').map((entry) => entry.file);
    const untrackedLines = await estimateUntrackedLines(gitRoot, untrackedFiles);

    return {
      changes: entries.map(({ file, changeType }) => ({ file, changeType })),
      diffLines: trackedDiffLines + untrackedLines,
      source: 'git',
    };
  } catch {
    return {
      changes: [],
      diffLines: 0,
      source: 'fallback',
    };
  }
}

export class ImplementationAgent implements Agent<ImplementationAgentInput, ImplementationAgentOutput> {
  readonly name = 'implementation_agent' as const;

  constructor(
    private readonly autonomyPolicy = new AutonomyPolicy(),
    private readonly backendRegistry = new AgentBackendRegistry()
  ) {}

  async canRun(context: AgentContext): Promise<boolean> {
    return context.envelope.constraints.canEditCode && Boolean(context.runtimeSnapshot.session.change_name);
  }

  async run(
    input: ImplementationAgentInput,
    context: AgentContext
  ): Promise<AgentResultEnvelope<ImplementationAgentOutput>> {
    const changeName = context.runtimeSnapshot.session.change_name;
    if (!changeName) {
      throw new Error('ImplementationAgent requires an active change. Run the spec and planning agents first.');
    }

    const excludedPrefixes = [
      '.openspec/',
      `openspec/changes/${changeName}/`,
    ];
    const initialDiffInspection = await inspectWorkspaceDiffWithExclusions(context.projectRoot, excludedPrefixes);
    const implementationPrompt = await buildImplementationPrompts(input, context, initialDiffInspection);
    const backendInvocation = await this.invokeConfiguredBackend(input, context, implementationPrompt);
    const workspaceActions = backendInvocation.proposed_workspace_actions ?? [];
    const actionExecutor = new WorkspaceActionExecutor({
      projectRoot: context.projectRoot,
      changeName,
    });
    const targetedFiles = actionExecutor.getTargetedFiles(workspaceActions);
    const proposedScope = targetedFiles.length > 0
      ? this.autonomyPolicy.evaluateImplementationScope({
          autonomyLevel: context.envelope.autonomy_level,
          changedFiles: targetedFiles,
          diffLines: 0,
        })
      : null;

    let workspaceExecution: WorkspaceExecutionSummary = {
      status: 'NOT_REQUESTED',
      applied_actions: 0,
      blocked_actions: 0,
      file_actions: 0,
      command_actions: 0,
      touched_files: [],
      command_results: [],
      errors: [],
    };
    if (workspaceActions.length > 0) {
      if (proposedScope?.requiresHumanApproval) {
        workspaceExecution = {
          status: 'BLOCKED',
          applied_actions: 0,
          blocked_actions: workspaceActions.length,
          file_actions: workspaceActions.filter((action) => action.type !== 'run_command').length,
          command_actions: workspaceActions.filter((action) => action.type === 'run_command').length,
          touched_files: [],
          command_results: [],
          errors: proposedScope.reasons,
        };
      } else {
        workspaceExecution = await actionExecutor.execute(workspaceActions);
      }
    }

    const diffInspection = await inspectWorkspaceDiffWithExclusions(context.projectRoot, excludedPrefixes);
    const relevantChanges = diffInspection.changes;
    const scope = this.autonomyPolicy.evaluateImplementationScope({
      autonomyLevel: context.envelope.autonomy_level,
      changedFiles: relevantChanges.map((entry) => entry.file),
      diffLines: diffInspection.diffLines,
    });

    const taskProgress = await getTaskProgressForChange(path.join(context.projectRoot, 'openspec', 'changes'), changeName);
    const testsAdded = relevantChanges
      .filter((entry) => isTestFile(entry.file) && entry.changeType !== 'deleted')
      .map((entry) => entry.file);

    const tasksCompleted = new Set<string>();
    if (taskProgress.total > 0 && taskProgress.completed === taskProgress.total) {
      for (const step of input.execution_plan.steps) {
        tasksCompleted.add(step.id);
      }
    } else {
      if (relevantChanges.length > 0) {
        tasksCompleted.add('P1');
        tasksCompleted.add('P2');
      }
      if (testsAdded.length > 0) {
        tasksCompleted.add('P3');
      }
    }

    const knownLimitations: string[] = [];
    if (!backendInvocation.configured) {
      knownLimitations.push(
        'No implementation backend is configured; the runtime only inspected the active workspace diff.'
      );
    }
    knownLimitations.push(...backendInvocation.notes);
    knownLimitations.push(...asStringArray(backendInvocation.structured_output?.limitations));
    if (backendInvocation.error) {
      knownLimitations.push(`Configured backend failure: ${backendInvocation.error}`);
    }
    if (diffInspection.source !== 'git') {
      knownLimitations.push('Git metadata was not available; scope inspection fell back to runtime defaults.');
    }
    if (workspaceExecution.status === 'BLOCKED') {
      knownLimitations.push('Backend proposed workspace actions that were blocked by autonomy policy.');
    }
    if (workspaceExecution.errors.length > 0) {
      knownLimitations.push(...workspaceExecution.errors.map((error) => `Workspace execution: ${error}`));
    }
    if (relevantChanges.length === 0) {
      knownLimitations.push('No workspace changes were detected for the active change.');
    }
    if (taskProgress.total > 0 && taskProgress.completed < taskProgress.total) {
      knownLimitations.push(`tasks.md still has ${taskProgress.total - taskProgress.completed} incomplete item(s).`);
    }

    const output: ImplementationAgentOutput = {
      changes_applied: relevantChanges.map((entry) => ({
        file: entry.file,
        change_type: entry.changeType,
        summary: toImplementationSummary(entry.changeType, entry.file),
      })),
      tasks_completed: input.execution_plan.steps.map((step) => step.id).filter((stepId) => tasksCompleted.has(stepId)),
      tasks_remaining: input.execution_plan.steps.map((step) => step.id).filter((stepId) => !tasksCompleted.has(stepId)),
      tests_added: testsAdded,
      known_limitations: knownLimitations,
      scope_assessment: {
        changed_files_count: scope.changedFilesCount,
        diff_lines: scope.diffLines,
        high_risk_files: scope.highRiskFiles,
        requires_human_approval: scope.requiresHumanApproval,
        policy_reasons: scope.reasons,
      },
      backend_invocation: backendInvocation,
      workspace_execution: workspaceExecution,
    };

    const shouldEscalate =
      scope.requiresHumanApproval
      || backendInvocation.status === 'FAILED'
      || workspaceExecution.status === 'BLOCKED'
      || workspaceExecution.status === 'FAILED'
      || (backendInvocation.mode === 'manual' && relevantChanges.length === 0);

    const humanQuestions = asStringArray(backendInvocation.structured_output?.human_questions);

    return {
      agent_name: this.name,
      status: shouldEscalate ? 'ESCALATED' : 'SUCCEEDED',
      output,
      artifact_refs: [],
      human_questions: humanQuestions,
      recommended_next_action: shouldEscalate ? 'REQUEST_HUMAN_APPROVAL' : 'RUN_CRITIC_AGENT',
    };
  }

  private async invokeConfiguredBackend(
    input: ImplementationAgentInput,
    context: AgentContext,
    prompt: { systemPrompt: string; taskPrompt: string; metadata: Record<string, unknown> }
  ): Promise<ImplementationBackendInvocation> {
    const resolvedBackend = this.backendRegistry.resolveForAgent(this.name);
    if (!resolvedBackend) {
      return {
        configured: false,
        mode: 'none',
        status: 'NOT_CONFIGURED',
        notes: [],
      };
    }

    try {
      const result = await this.backendRegistry.invoke(resolvedBackend, {
        agent_name: this.name,
        workspace_root: context.projectRoot,
        change_name: context.runtimeSnapshot.session.change_name,
        input_refs: context.envelope.input_refs,
        constraints: context.envelope.constraints,
        budget: context.envelope.budget,
        system_prompt: prompt.systemPrompt,
        task_prompt: prompt.taskPrompt,
        metadata: {
          ...prompt.metadata,
          normalized_context: input.normalized_context,
          execution_plan: input.execution_plan,
        },
      });
      return this.toBackendInvocation(result);
    } catch (error) {
      return {
        configured: true,
        backend_name: resolvedBackend.name,
        mode: resolvedBackend.config.mode,
        status: 'FAILED',
        system_prompt: prompt.systemPrompt,
        task_prompt: prompt.taskPrompt,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private toBackendInvocation(result: AgentInvocationResult): ImplementationBackendInvocation {
    return {
      configured: true,
      backend_name: result.backend_name,
      mode: result.mode,
      status: result.status === 'prepared' ? 'PREPARED' : 'EXECUTED',
      system_prompt: result.system_prompt,
      task_prompt: result.task_prompt,
      request_payload: result.request_payload,
      response_payload: result.response_payload,
      structured_output: result.structured_output,
      notes: result.notes,
      proposed_workspace_actions: parseWorkspaceActions(result.structured_output?.workspace_actions),
    };
  }
}
