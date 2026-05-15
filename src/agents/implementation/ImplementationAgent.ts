import path from 'path';
import { getTaskProgressForChange } from '../../utils/task-progress.js';
import { AutonomyPolicy } from '../../core/runtime/orchestration/AutonomyPolicy.js';
import { AgentBackendRegistry } from '../../core/runtime/agent-backends/BackendRegistry.js';
import type { AgentInvocationResult } from '../../core/runtime/agent-backends/types.js';
import type { AgentBackendMode } from '../../core/runtime/agent-backends/config.js';
import {
  captureWorkspaceDiffBaseline,
  disposeWorkspaceDiffBaseline,
  inspectWorkspaceDiffSinceBaseline,
  inspectWorkspaceDiffWithExclusions,
} from '../../core/runtime/workspace-diff.js';
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
import type { CriticAgentOutput } from '../critic/CriticAgent.js';
import type { ExecutionPlan } from '../planning/PlanningAgent.js';
import type { ValidationAgentOutput } from '../validation/ValidationAgent.js';

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
  previous_critic_report?: CriticAgentOutput;
  previous_validation_report?: ValidationAgentOutput;
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
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
  };
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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 15)}...[truncated]`;
}

function summarizeNormalizedContext(input: NormalizedContext): Record<string, unknown> {
  return {
    problem_statement: truncateText(input.problem_statement, 1200),
    acceptance_criteria: input.acceptance_criteria.slice(0, 8),
    business_rules: input.business_rules.slice(0, 8),
    ambiguities: input.ambiguities.slice(0, 6),
    risks: input.risks.slice(0, 6),
    integrations: input.integrations.slice(0, 6),
    out_of_scope: input.out_of_scope.slice(0, 6),
    source_summary: input.source_summary ? truncateText(input.source_summary, 400) : undefined,
  };
}

function summarizeExecutionPlan(plan: ExecutionPlan): Record<string, unknown> {
  return {
    objective: truncateText(plan.objective, 500),
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: truncateText(step.title, 160),
      owner: step.owner,
    })),
    files_likely_affected: plan.files_likely_affected.slice(0, 12),
    test_strategy: plan.test_strategy,
    rollback_strategy: truncateText(plan.rollback_strategy, 240),
    estimated_risk: plan.estimated_risk,
  };
}

function summarizeCriticFeedback(report: CriticAgentOutput | undefined): Record<string, unknown> | undefined {
  if (!report) {
    return undefined;
  }

  return {
    review_result: report.review_result,
    findings: report.findings.slice(0, 8).map((finding) => ({
      severity: finding.severity,
      type: finding.type,
      file: finding.file,
      message: truncateText(finding.message, 240),
    })),
  };
}

function summarizeValidationFeedback(report: ValidationAgentOutput | undefined): Record<string, unknown> | undefined {
  if (!report) {
    return undefined;
  }

  return {
    validation_result: report.validation_result,
    failure_classification: report.failure_classification,
    archive_eligible: report.archive_eligible,
    reasons: report.reasons.slice(0, 8).map((reason) => truncateText(reason, 240)),
    checks: report.checks.slice(0, 8).map((check) => ({
      name: check.name,
      status: check.status,
      details: check.details ? truncateText(check.details, 240) : undefined,
    })),
  };
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
  const contextSummary = summarizeNormalizedContext(input.normalized_context);
  const executionPlanSummary = summarizeExecutionPlan(input.execution_plan);
  const criticFeedback = summarizeCriticFeedback(input.previous_critic_report);
  const validationFeedback = summarizeValidationFeedback(input.previous_validation_report);
  const systemPrompt = [
    'You are the ImplementationAgent for the OpenSpec agentic runtime.',
    'If your backend can edit the workspace, apply the requested code and test changes within the allowed constraints.',
    'Always return JSON only with keys: status, summary, files_touched, tests_added, limitations, human_questions, workspace_actions.',
    'workspace_actions can contain write_file, replace_in_file, delete_file, and run_command actions.',
    'Use run_command only for focused verification commands such as node --test, pnpm test, vitest, or tsc --noEmit.',
    'If you cannot edit files directly, return the intended edits as workspace_actions so the runtime can apply them locally.',
    'Do not rely on large inline file dumps; inspect the repository and referenced artifacts directly when you need more detail.',
    'Keep the active OpenSpec tasks.md aligned with the work you actually complete, and update it when implementation progress changes.',
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
    '# Context Summary',
    stringifyJson(contextSummary),
    '',
    '# Execution Plan Summary',
    stringifyJson(executionPlanSummary),
    '',
    '# Prior Critic Feedback',
    criticFeedback ? stringifyJson(criticFeedback) : 'None available for this implementation cycle.',
    '',
    '# Prior Validation Feedback',
    validationFeedback ? stringifyJson(validationFeedback) : 'None available for this implementation cycle.',
    '',
    '# Current Workspace Snapshot',
    stringifyJson({
      diff_source: diffInspection.source,
      diff_lines: diffInspection.diffLines,
      changed_files: summarizeDiff(diffInspection.changes),
    }),
    '',
    '# Artifact Refs',
    context.envelope.input_refs.length > 0
      ? context.envelope.input_refs.map((ref) => `- ${ref}`).join('\n')
      : '- None',
    '',
    '# Files Likely Affected',
    input.execution_plan.files_likely_affected.length > 0
      ? input.execution_plan.files_likely_affected.map((file) => `- ${file}`).join('\n')
      : '- None identified yet',
    '',
    '# Instructions',
    '- Prefer minimal, production-ready edits.',
    '- Update or add tests when the plan requires them.',
    '- If prior critic or validation feedback is present, address those findings explicitly before making speculative changes.',
    '- Treat openspec/changes/<change>/tasks.md as part of the implementation surface and keep it synchronized with the work completed in this run.',
    '- Respect high-risk path guards and do not exceed the allowed file/diff budget.',
    '- Inspect files from the workspace or artifact refs instead of assuming the summaries are exhaustive.',
    '- Return JSON only.',
    '- If you want the runtime to modify files locally, include workspace_actions.',
  ].join('\n');

  return {
    systemPrompt,
    taskPrompt,
    metadata: {
      execution_plan_step_ids: input.execution_plan.steps.map((step) => step.id),
      likely_affected_files: input.execution_plan.files_likely_affected,
      input_refs: context.envelope.input_refs,
      has_previous_critic_report: Boolean(input.previous_critic_report),
      has_previous_validation_report: Boolean(input.previous_validation_report),
    },
  };
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
    const baseline = await captureWorkspaceDiffBaseline(context.projectRoot, excludedPrefixes);
    try {
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

      const diffInspection = await inspectWorkspaceDiffSinceBaseline(context.projectRoot, excludedPrefixes, baseline);
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
    } finally {
      await disposeWorkspaceDiffBaseline(baseline);
    }
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
        run_id: context.envelope.run_id,
        ticket_key: context.envelope.ticket_key,
        session_id: context.envelope.session_id,
        change_name: context.runtimeSnapshot.session.change_name,
        input_refs: context.envelope.input_refs,
        constraints: context.envelope.constraints,
        budget: context.envelope.budget,
        system_prompt: prompt.systemPrompt,
        task_prompt: prompt.taskPrompt,
        metadata: prompt.metadata,
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
      usage: result.usage,
      notes: result.notes,
      proposed_workspace_actions: parseWorkspaceActions(result.structured_output?.workspace_actions),
    };
  }
}
