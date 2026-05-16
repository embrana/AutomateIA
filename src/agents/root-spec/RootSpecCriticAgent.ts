import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';
import { AgentBackendRegistry } from '../../core/runtime/agent-backends/BackendRegistry.js';
import type { AgentBackendMode } from '../../core/runtime/agent-backends/config.js';
import type { AgentInvocationResult } from '../../core/runtime/agent-backends/types.js';
import type { ProjectEvidenceSummary } from './ProjectEvidenceResolverAgent.js';

export interface RootSpecReviewFinding {
  severity: 'high' | 'medium' | 'low';
  type: string;
  file?: string;
  message: string;
}

export interface RootSpecCriticInput {
  normalized_context: NormalizedContext;
  project_evidence: ProjectEvidenceSummary;
  root_spec_markdown: string;
}

export interface RootSpecCriticBackendInvocation {
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

export interface RootSpecCriticOutput {
  review_result: 'APPROVED' | 'CHANGES_REQUESTED';
  blocker_classification: 'ACCEPTABLE' | 'RESOLVABLE_TECHNICAL_TBDS' | 'BUSINESS_CLARIFICATION_REQUIRED';
  findings: RootSpecReviewFinding[];
  human_questions: string[];
  backend_invocation: RootSpecCriticBackendInvocation;
}

const REQUIRED_SECTIONS = [
  '## Context',
  '## Goals',
  '## Non-Goals',
  '## Acceptance Criteria',
  '## Business Rules',
  '## Domain / Data / Integration Contracts',
  '## UX / Error States',
  '## Out of Scope',
  '## Traceability',
  '## Quality Checklist',
];

const TECHNICAL_TBD_KEYWORDS = [
  'api',
  'endpoint',
  'schema',
  'database',
  'db',
  'table',
  'column',
  'payload',
  'contract',
  'enum',
  'migration',
  'infra',
  'auth',
  'provider',
  'integration',
];

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 15)}...[truncated]`;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asReviewResult(value: unknown): RootSpecCriticOutput['review_result'] | undefined {
  return value === 'APPROVED' || value === 'CHANGES_REQUESTED' ? value : undefined;
}

function asBlockerClassification(value: unknown): RootSpecCriticOutput['blocker_classification'] | undefined {
  return value === 'ACCEPTABLE'
    || value === 'RESOLVABLE_TECHNICAL_TBDS'
    || value === 'BUSINESS_CLARIFICATION_REQUIRED'
    ? value
    : undefined;
}

function parseBackendFindings(value: unknown): RootSpecReviewFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const severity = (item as { severity?: unknown }).severity;
    const type = (item as { type?: unknown }).type;
    const message = (item as { message?: unknown }).message;
    const file = (item as { file?: unknown }).file;
    if (
      (severity !== 'high' && severity !== 'medium' && severity !== 'low')
      || typeof type !== 'string'
      || typeof message !== 'string'
    ) {
      return [];
    }
    return [{
      severity,
      type,
      message,
      file: typeof file === 'string' ? file : undefined,
    }];
  });
}

function dedupeFindings(findings: RootSpecReviewFinding[]): RootSpecReviewFinding[] {
  const seen = new Set<string>();
  const deduped: RootSpecReviewFinding[] = [];
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

function extractTbdLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\bTBD\b/i.test(line))
    .filter((line) => !line.startsWith('- [ ]'));
}

function isTechnicalTbd(value: string): boolean {
  const lower = value.toLowerCase();
  return TECHNICAL_TBD_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function summarizeContext(normalizedContext: NormalizedContext): Record<string, unknown> {
  return {
    problem_statement: truncateText(normalizedContext.problem_statement, 1000),
    acceptance_criteria: normalizedContext.acceptance_criteria.slice(0, 12),
    business_rules: normalizedContext.business_rules.slice(0, 10),
    ambiguities: normalizedContext.ambiguities.slice(0, 8),
    risks: normalizedContext.risks.slice(0, 8),
  };
}

function summarizeEvidence(projectEvidence: ProjectEvidenceSummary): Record<string, unknown> {
  return {
    impacted_layers: projectEvidence.impacted_layers,
    api_contract_refs: projectEvidence.api_contract_refs.slice(0, 12),
    data_model_refs: projectEvidence.data_model_refs.slice(0, 12),
    migration_refs: projectEvidence.migration_refs.slice(0, 12),
    technical_constraints: projectEvidence.technical_constraints.slice(0, 12),
  };
}

function buildDeterministicReview(input: RootSpecCriticInput): {
  findings: RootSpecReviewFinding[];
  blockerClassification: RootSpecCriticOutput['blocker_classification'];
  humanQuestions: string[];
} {
  const findings: RootSpecReviewFinding[] = [];
  const humanQuestions: string[] = [];

  const missingSections = REQUIRED_SECTIONS.filter((heading) => !input.root_spec_markdown.includes(heading));
  for (const heading of missingSections) {
    findings.push({
      severity: 'high',
      type: 'missing_section',
      message: `The root spec is missing required section "${heading}".`,
    });
  }

  const specCaCount = Array.from(input.root_spec_markdown.matchAll(/^###\s+(CA-\d+)/gim)).length;
  if (input.normalized_context.acceptance_criteria.length > 0 && specCaCount < input.normalized_context.acceptance_criteria.length) {
    findings.push({
      severity: 'high',
      type: 'acceptance_criteria_loss',
      message: 'The generated root spec appears to preserve fewer observable acceptance criteria than the imported context.',
    });
  }

  const tbdLines = extractTbdLines(input.root_spec_markdown);
  const technicalTbdLines = tbdLines.filter((line) => isTechnicalTbd(line));
  const businessTbdLines = tbdLines.filter((line) => !isTechnicalTbd(line));

  if (technicalTbdLines.length > 0) {
    findings.push({
      severity: 'medium',
      type: 'technical_tbd',
      message: `Technical TBDs remain in the root spec: ${technicalTbdLines.slice(0, 3).join(' | ')}`,
    });
  }
  if (businessTbdLines.length > 0) {
    findings.push({
      severity: 'medium',
      type: 'business_tbd',
      message: `Business TBDs remain in the root spec: ${businessTbdLines.slice(0, 3).join(' | ')}`,
    });
    humanQuestions.push(...businessTbdLines.map((line) => line.replace(/^-+\s*/, '')));
  }

  if (!input.root_spec_markdown.includes('## Traceability') || !/- CA-\d+:/m.test(input.root_spec_markdown)) {
    findings.push({
      severity: 'medium',
      type: 'traceability_gap',
      message: 'Traceability is missing or does not map acceptance criteria to impacted layers or modules.',
    });
  }

  let blockerClassification: RootSpecCriticOutput['blocker_classification'] = 'ACCEPTABLE';
  if (businessTbdLines.length > 0) {
    blockerClassification = 'BUSINESS_CLARIFICATION_REQUIRED';
  } else if (technicalTbdLines.length > 0 || missingSections.length > 0) {
    blockerClassification = 'RESOLVABLE_TECHNICAL_TBDS';
  }

  return {
    findings,
    blockerClassification,
    humanQuestions,
  };
}

export class RootSpecCriticAgent implements Agent<RootSpecCriticInput, RootSpecCriticOutput> {
  readonly name = 'root_spec_critic_agent' as const;

  constructor(
    private readonly backendRegistry = new AgentBackendRegistry()
  ) {}

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.ticket.key);
  }

  async run(
    input: RootSpecCriticInput,
    context: AgentContext
  ): Promise<AgentResultEnvelope<RootSpecCriticOutput>> {
    const deterministic = buildDeterministicReview(input);
    const backendInvocation = await this.invokeConfiguredBackend(input, context);
    const backendFindings = parseBackendFindings(backendInvocation.structured_output?.findings);
    const backendReviewResult = asReviewResult(backendInvocation.structured_output?.review_result);
    const backendBlockerClassification = asBlockerClassification(backendInvocation.structured_output?.blocker_classification);
    const backendQuestions = asStringArray(backendInvocation.structured_output?.human_questions);

    let findings = dedupeFindings([...deterministic.findings, ...backendFindings]);
    let blockerClassification = deterministic.blockerClassification;
    if (backendBlockerClassification) {
      blockerClassification = backendBlockerClassification;
    }

    if (backendReviewResult === 'CHANGES_REQUESTED' && backendFindings.length === 0) {
      findings = dedupeFindings([
        ...findings,
        {
          severity: 'medium',
          type: 'backend_review_request',
          message: 'Configured root spec reviewer requested changes but did not provide explicit structured findings.',
        },
      ]);
    }

    if (findings.every((finding) => finding.severity === 'low') && blockerClassification === 'ACCEPTABLE') {
      findings = dedupeFindings(findings);
    }

    const reviewResult = findings.some((finding) => finding.severity === 'high' || finding.severity === 'medium')
      ? 'CHANGES_REQUESTED'
      : 'APPROVED';
    const humanQuestions = Array.from(new Set([...deterministic.humanQuestions, ...backendQuestions]));

    const output: RootSpecCriticOutput = {
      review_result: reviewResult,
      blocker_classification: reviewResult === 'APPROVED'
        ? 'ACCEPTABLE'
        : blockerClassification,
      findings,
      human_questions: humanQuestions,
      backend_invocation: backendInvocation,
    };

    const recommendedNextAction = output.review_result === 'APPROVED'
      ? 'RUN_SPEC_AGENT'
      : output.blocker_classification === 'BUSINESS_CLARIFICATION_REQUIRED'
        ? 'REQUEST_HUMAN_APPROVAL'
        : 'RUN_PROJECT_EVIDENCE_RESOLVER_AGENT';

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output,
      artifact_refs: [],
      human_questions: humanQuestions,
      recommended_next_action: recommendedNextAction,
    };
  }

  private async invokeConfiguredBackend(
    input: RootSpecCriticInput,
    context: AgentContext
  ): Promise<RootSpecCriticBackendInvocation> {
    const resolvedBackend = this.backendRegistry.resolveForAgent(this.name, { allowDefaultFallback: false });
    if (!resolvedBackend) {
      return {
        configured: false,
        mode: 'none',
        status: 'NOT_CONFIGURED',
        notes: [],
      };
    }

    const systemPrompt = [
      'You are the RootSpecCriticAgent for the OpenSpec agentic runtime.',
      'Review the generated root spec against the normalized context and project evidence.',
      'Return JSON only with keys: review_result, blocker_classification, findings, human_questions.',
      'Allowed blocker_classification values: ACCEPTABLE, RESOLVABLE_TECHNICAL_TBDS, BUSINESS_CLARIFICATION_REQUIRED.',
      'If you request changes, provide explicit findings.',
    ].join(' ');

    const taskPrompt = [
      '# Root Spec Review Target',
      `Ticket: ${context.envelope.ticket_key}`,
      '',
      '# Normalized Context',
      stringifyJson(summarizeContext(input.normalized_context)),
      '',
      '# Project Evidence',
      stringifyJson(summarizeEvidence(input.project_evidence)),
      '',
      '# Root Spec Draft',
      input.root_spec_markdown,
      '',
      '# Instructions',
      '- Preserve previously imported observable criteria.',
      '- Flag missing sections, loss of acceptance criteria, unresolved TBDs, and weak traceability.',
      '- Use BUSINESS_CLARIFICATION_REQUIRED only for product or scope TBDs.',
      '- Use RESOLVABLE_TECHNICAL_TBDS only when the issue should loop back through project evidence or root-spec refinement.',
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
          impacted_layers: input.project_evidence.impacted_layers,
          tbd_count: (input.root_spec_markdown.match(/\bTBD\b/g) ?? []).length,
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

  private toBackendInvocation(result: AgentInvocationResult): RootSpecCriticBackendInvocation {
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
