import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';
import { AgentBackendRegistry } from '../../core/runtime/agent-backends/BackendRegistry.js';
import type { AgentBackendMode } from '../../core/runtime/agent-backends/config.js';
import type { AgentInvocationResult } from '../../core/runtime/agent-backends/types.js';
import type { ImplementationAgentOutput } from '../implementation/ImplementationAgent.js';
import type { ExecutionPlan } from '../planning/PlanningAgent.js';

export interface CriticFinding {
  severity: 'high' | 'medium' | 'low';
  type: string;
  file?: string;
  message: string;
}

export interface CriticAgentInput {
  normalized_context: NormalizedContext;
  execution_plan: ExecutionPlan;
  implementation_report: ImplementationAgentOutput;
}

export interface CriticAgentOutput {
  review_result: 'APPROVED' | 'CHANGES_REQUESTED';
  findings: CriticFinding[];
  backend_invocation: CriticBackendInvocation;
}

export interface CriticBackendInvocation {
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
}

function buildOverlapSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 15)}...[truncated]`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function asReviewResult(value: unknown): CriticAgentOutput['review_result'] | undefined {
  return value === 'APPROVED' || value === 'CHANGES_REQUESTED' ? value : undefined;
}

function asFindingSeverity(value: unknown): CriticFinding['severity'] | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

function parseBackendFindings(value: unknown): CriticFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const severity = asFindingSeverity((item as { severity?: unknown }).severity);
    const type = typeof (item as { type?: unknown }).type === 'string' ? (item as { type: string }).type.trim() : '';
    const message = typeof (item as { message?: unknown }).message === 'string'
      ? (item as { message: string }).message.trim()
      : '';
    const file = typeof (item as { file?: unknown }).file === 'string'
      ? (item as { file: string }).file.trim()
      : undefined;

    if (!severity || !type || !message) {
      return [];
    }

    return [{
      severity,
      type,
      file: file || undefined,
      message,
    }];
  });
}

function dedupeFindings(findings: CriticFinding[]): CriticFinding[] {
  const seen = new Set<string>();
  const deduped: CriticFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.type}:${finding.file ?? ''}:${finding.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

function summarizeNormalizedContext(input: NormalizedContext): Record<string, unknown> {
  return {
    problem_statement: truncateText(input.problem_statement, 1000),
    acceptance_criteria: input.acceptance_criteria.slice(0, 8),
    ambiguities: input.ambiguities.slice(0, 6),
    risks: input.risks.slice(0, 6),
    integrations: input.integrations.slice(0, 6),
  };
}

function summarizeExecutionPlan(plan: ExecutionPlan): Record<string, unknown> {
  return {
    objective: truncateText(plan.objective, 400),
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: truncateText(step.title, 160),
      owner: step.owner,
    })),
    files_likely_affected: plan.files_likely_affected.slice(0, 12),
    test_strategy: plan.test_strategy,
    estimated_risk: plan.estimated_risk,
  };
}

function summarizeImplementationReport(report: ImplementationAgentOutput): Record<string, unknown> {
  return {
    changed_files: report.changes_applied.map((item) => ({
      file: item.file,
      change_type: item.change_type,
      summary: truncateText(item.summary, 120),
    })),
    tasks_completed: report.tasks_completed,
    tasks_remaining: report.tasks_remaining,
    tests_added: report.tests_added,
    scope_assessment: report.scope_assessment,
    known_limitations: report.known_limitations.slice(0, 10).map((value) => truncateText(value, 200)),
  };
}

function buildDeterministicFindings(input: CriticAgentInput): CriticFinding[] {
  const findings: CriticFinding[] = [];
  const changedFiles = input.implementation_report.changes_applied.map((item) => item.file);
  const changedFileSet = buildOverlapSet(changedFiles);
  const plannedOverlap = input.execution_plan.files_likely_affected.filter((file) =>
    changedFileSet.has(file.toLowerCase())
  );

  if (input.implementation_report.scope_assessment.requires_human_approval) {
    findings.push({
      severity: 'high',
      type: 'policy_violation',
      message: input.implementation_report.scope_assessment.policy_reasons.join('; '),
    });
  }

  if (input.implementation_report.changes_applied.length === 0) {
    findings.push({
      severity: 'high',
      type: 'missing_implementation',
      message: 'No workspace changes were detected for the active execution cycle.',
    });
  }

  if (input.normalized_context.ambiguities.length > 0) {
    findings.push({
      severity: 'medium',
      type: 'spec_ambiguity',
      message: `Open ambiguities remain: ${input.normalized_context.ambiguities.join('; ')}`,
    });
  }

  if (plannedOverlap.length === 0 && changedFiles.length > 0) {
    findings.push({
      severity: 'low',
      type: 'plan_drift',
      message: 'Observed workspace changes do not overlap with the execution plan impact set.',
    });
  }

  if (input.execution_plan.test_strategy.length > 0 && input.implementation_report.tests_added.length === 0) {
    findings.push({
      severity: 'medium',
      type: 'missing_test_coverage',
      message: 'Implementation report did not include new or updated test files.',
    });
  }

  if (input.implementation_report.tasks_remaining.length > 0) {
    findings.push({
      severity: 'low',
      type: 'tasks_incomplete',
      message: `Plan steps still pending: ${input.implementation_report.tasks_remaining.join(', ')}`,
    });
  }

  return findings;
}

export class CriticAgent implements Agent<CriticAgentInput, CriticAgentOutput> {
  readonly name = 'critic_agent' as const;

  constructor(
    private readonly backendRegistry = new AgentBackendRegistry()
  ) {}

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.runtimeSnapshot.session.change_name);
  }

  async run(
    input: CriticAgentInput,
    context: AgentContext
  ): Promise<AgentResultEnvelope<CriticAgentOutput>> {
    const deterministicFindings = buildDeterministicFindings(input);
    const backendInvocation = await this.invokeConfiguredBackend(input, context);
    const backendFindings = parseBackendFindings(backendInvocation.structured_output?.findings);
    const backendReviewResult = asReviewResult(backendInvocation.structured_output?.review_result);

    let findings = dedupeFindings([...deterministicFindings, ...backendFindings]);
    if (backendReviewResult === 'CHANGES_REQUESTED' && backendFindings.length === 0) {
      findings = dedupeFindings([
        ...findings,
        {
          severity: 'medium',
          type: 'backend_review_request',
          message: 'Configured critic backend requested changes but did not provide explicit findings.',
        },
      ]);
    }

    const blockingFindings = findings.filter((finding) => finding.severity === 'high' || finding.severity === 'medium');
    const reviewResult = blockingFindings.length > 0 ? 'CHANGES_REQUESTED' : 'APPROVED';
    const humanQuestions = asStringArray(backendInvocation.structured_output?.human_questions);

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output: {
        review_result: reviewResult,
        findings,
        backend_invocation: backendInvocation,
      },
      artifact_refs: [],
      human_questions: humanQuestions,
      recommended_next_action: reviewResult === 'APPROVED'
        ? 'RUN_VALIDATION_AGENT'
        : input.implementation_report.scope_assessment.requires_human_approval
          ? 'REQUEST_HUMAN_APPROVAL'
          : 'RUN_IMPLEMENTATION_AGENT',
    };
  }

  private async invokeConfiguredBackend(
    input: CriticAgentInput,
    context: AgentContext
  ): Promise<CriticBackendInvocation> {
    const resolvedBackend = this.backendRegistry.resolveForAgent(this.name);
    if (!resolvedBackend) {
      return {
        configured: false,
        mode: 'none',
        status: 'NOT_CONFIGURED',
        notes: [],
      };
    }

    const systemPrompt = [
      'You are the CriticAgent for the OpenSpec agentic runtime.',
      'Review the implementation report against the normalized context and execution plan.',
      'Return JSON only with keys: review_result, findings, human_questions, limitations.',
      'Each finding must include severity, type, optional file, and message.',
      'Use CHANGES_REQUESTED only when there is a concrete issue that should send the loop back to implementation.',
      'Prefer concise findings tied to evidence in the implementation report or plan.',
    ].join(' ');

    const taskPrompt = [
      '# Review Target',
      `Ticket: ${context.envelope.ticket_key}`,
      `Change: ${context.envelope.change_name ?? '(no active change)'}`,
      '',
      '# Context Summary',
      stringifyJson(summarizeNormalizedContext(input.normalized_context)),
      '',
      '# Execution Plan Summary',
      stringifyJson(summarizeExecutionPlan(input.execution_plan)),
      '',
      '# Implementation Report Summary',
      stringifyJson(summarizeImplementationReport(input.implementation_report)),
      '',
      '# Artifact Refs',
      context.envelope.input_refs.length > 0
        ? context.envelope.input_refs.map((ref) => `- ${ref}`).join('\n')
        : '- None',
      '',
      '# Instructions',
      '- Focus on correctness, coverage, plan drift, unresolved ambiguity, and risky scope.',
      '- If the implementation is acceptable, return review_result APPROVED and findings [].',
      '- If you request changes, provide explicit findings that explain why.',
      '- Return JSON only.',
    ].join('\n');

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
        system_prompt: systemPrompt,
        task_prompt: taskPrompt,
        metadata: {
          input_refs: context.envelope.input_refs,
          likely_affected_files: input.execution_plan.files_likely_affected,
          tasks_remaining: input.implementation_report.tasks_remaining,
          tests_added: input.implementation_report.tests_added,
        },
      });
      return this.toBackendInvocation(result);
    } catch (error) {
      return {
        configured: true,
        backend_name: resolvedBackend.name,
        mode: resolvedBackend.config.mode,
        status: 'FAILED',
        system_prompt: systemPrompt,
        task_prompt: taskPrompt,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private toBackendInvocation(result: AgentInvocationResult): CriticBackendInvocation {
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
    };
  }
}
