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
import { ROOT_SPEC_AUTHOR_SYSTEM_PROMPT } from './root-spec-prompt.js';

export interface RootSpecAuthorInput {
  normalized_context: NormalizedContext;
  project_evidence: ProjectEvidenceSummary;
  clarification_notes: string[];
  previous_review?: RootSpecCriticSnapshot;
}

export interface RootSpecCriticSnapshot {
  blocker_classification: 'ACCEPTABLE' | 'RESOLVABLE_TECHNICAL_TBDS' | 'BUSINESS_CLARIFICATION_REQUIRED';
  findings: Array<{ severity: 'high' | 'medium' | 'low'; type: string; message: string; file?: string }>;
  human_questions?: string[];
}

export interface RootSpecBackendInvocation {
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

export interface RootSpecAuthorOutput {
  spec_markdown: string;
  metadata: {
    spec_id: string;
    assumptions: string[];
    open_questions: string[];
    detected_tbd_count: number;
    evidence_refs: string[];
  };
  backend_invocation: RootSpecBackendInvocation;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 15)}...[truncated]`;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function inferDefaultOwner(context: AgentContext): string {
  return context.ticket.assignee ?? 'Unassigned';
}

function summarizeNormalizedContext(input: NormalizedContext): Record<string, unknown> {
  return {
    problem_statement: truncateText(input.problem_statement, 1200),
    acceptance_criteria: input.acceptance_criteria.slice(0, 12),
    business_rules: input.business_rules.slice(0, 10),
    data_contracts: input.data_contracts.slice(0, 10),
    integrations: input.integrations.slice(0, 8),
    out_of_scope: input.out_of_scope.slice(0, 8),
    ambiguities: input.ambiguities.slice(0, 8),
    risks: input.risks.slice(0, 8),
  };
}

function summarizeProjectEvidence(evidence: ProjectEvidenceSummary): Record<string, unknown> {
  return {
    repository_summary: evidence.repository_summary,
    impacted_layers: evidence.impacted_layers,
    documentation_refs: evidence.documentation_refs.slice(0, 12),
    api_contract_refs: evidence.api_contract_refs.slice(0, 12),
    data_model_refs: evidence.data_model_refs.slice(0, 12),
    migration_refs: evidence.migration_refs.slice(0, 12),
    test_refs: evidence.test_refs.slice(0, 12),
    technical_constraints: evidence.technical_constraints.slice(0, 12),
    unresolved_technical_tbds: evidence.unresolved_technical_tbds.slice(0, 8),
  };
}

function normalizeCriterionBody(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [
      '- **GIVEN** the feature context exists',
      '- **WHEN** the actor executes the requested behavior',
      '- **THEN** the system SHALL satisfy the expected result',
    ];
  }

  if (/\bGIVEN\b/i.test(trimmed) && /\bTHEN\b/i.test(trimmed)) {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.startsWith('- ') ? line : `- ${line}`);
  }

  return [
    '- **GIVEN** the actor is within the supported feature scope',
    `- **WHEN** ${trimmed.replace(/\.$/, '')}`,
    '- **THEN** the system SHALL expose observable behavior that satisfies the requested outcome',
  ];
}

function buildFallbackSpec(input: RootSpecAuthorInput, context: AgentContext): RootSpecAuthorOutput {
  const featureName = context.ticket.summary || `Feature for ${context.envelope.ticket_key}`;
  const specId = `${context.envelope.ticket_key}-root-spec`;
  const assumptions = [
    ...input.project_evidence.technical_constraints.slice(0, 4),
    ...(input.clarification_notes.length > 0
      ? input.clarification_notes.map((item) => `Clarification applied: ${item}`)
      : []),
  ];

  const openQuestions = [
    ...input.normalized_context.ambiguities,
    ...input.project_evidence.unresolved_technical_tbds,
  ];
  const acceptanceCriteria = input.normalized_context.acceptance_criteria.length > 0
    ? input.normalized_context.acceptance_criteria
    : ['TBD: acceptance criteria were not explicit in the imported ticket.'];

  const traceabilityLayers = input.project_evidence.impacted_layers.length > 0
    ? input.project_evidence.impacted_layers.join(', ')
    : 'backend, shared';

  const specMarkdown = [
    `# SPEC: ${featureName}`,
    `# Spec-ID: ${specId}`,
    '# Sprint: Backlog',
    '# Status: Draft',
    `# Owner: ${inferDefaultOwner(context) || 'Unassigned'}`,
    '# Reviewer: Unassigned',
    '',
    '## Context',
    input.normalized_context.problem_statement || 'The imported ticket did not include a fully explicit business context.',
    ...(input.clarification_notes.length > 0
      ? ['', 'Clarifications applied during discovery:', ...input.clarification_notes.map((note) => `- ${note}`)]
      : []),
    '',
    '## Goals',
    ...(acceptanceCriteria.map((criterion) => `- ${criterion}`)),
    '',
    '## Non-Goals',
    ...(input.normalized_context.out_of_scope.length > 0
      ? input.normalized_context.out_of_scope.map((item) => `- ${item}`)
      : ['- No explicit non-goals were documented in the imported ticket.']),
    '',
    '## Acceptance Criteria',
    ...acceptanceCriteria.flatMap((criterion, index) => [
      `### CA-${index + 1} - ${truncateText(criterion, 100)}`,
      ...normalizeCriterionBody(criterion),
      '',
    ]),
    '## Business Rules',
    ...(input.normalized_context.business_rules.length > 0
      ? input.normalized_context.business_rules.map((rule) => `- ${rule}`)
      : ['- No explicit stable business rules were documented in the imported ticket.']),
    '',
    '## Domain / Data / Integration Contracts',
    ...(input.normalized_context.data_contracts.length > 0
      ? input.normalized_context.data_contracts.map((item) => `- ${item}`)
      : ['- No explicit domain or data contract was documented in the imported ticket.']),
    ...input.project_evidence.api_contract_refs.map((ref) => `- Existing project API evidence: ${ref}`),
    ...input.project_evidence.data_model_refs.map((ref) => `- Existing project data model evidence: ${ref}`),
    ...(input.project_evidence.api_contract_refs.length === 0 && input.project_evidence.data_model_refs.length === 0
      ? ['- Repository scan did not confirm explicit API or schema artifacts for this feature area.']
      : []),
    '',
    '## UX / Error States',
    '- Loading: the affected surface SHALL expose an explicit loading state when data or transitions are pending.',
    '- Validation: the system SHALL present observable validation feedback when required inputs are missing or invalid.',
    '- Error: the system SHALL preserve enough context for the user to recover from known failure states.',
    ...(input.normalized_context.risks.map((risk) => `- Risk note: ${risk}`)),
    '',
    '## Out of Scope',
    ...(input.normalized_context.out_of_scope.length > 0
      ? input.normalized_context.out_of_scope.map((item) => `- ${item}`)
      : ['- Any implementation details not required to satisfy the observable acceptance criteria.']),
    '',
    '## Traceability',
    ...acceptanceCriteria.map((_, index) => `- CA-${index + 1}: ${traceabilityLayers}`),
    '',
    '## Appendix A — BDD Scenarios (optional)',
    '- Add detailed BDD scenarios only if the feature requires higher behavioral precision.',
    '',
    '## Quality Checklist',
    '- [ ] Todos los CAs tienen cobertura funcional',
    '- [ ] Casos de error documentados',
    '- [ ] Reglas de negocio explícitas',
    '- [ ] Contratos lógicos definidos o marcados como TBD',
    '- [ ] Out of scope explícito',
    '- [ ] Traceability completa',
    '- [ ] Validado por PO',
    '- [ ] Validado por TL',
  ].join('\n');

  return {
    spec_markdown: `${specMarkdown}\n`,
    metadata: {
      spec_id: specId,
      assumptions,
      open_questions: openQuestions,
      detected_tbd_count: (specMarkdown.match(/\bTBD\b/g) ?? []).length,
      evidence_refs: [
        ...input.project_evidence.documentation_refs,
        ...input.project_evidence.api_contract_refs,
        ...input.project_evidence.data_model_refs,
      ].slice(0, 20),
    },
    backend_invocation: {
      configured: false,
      mode: 'none',
      status: 'NOT_CONFIGURED',
      notes: [],
    },
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readSpecMarkdown(structuredOutput: Record<string, unknown> | null, responsePayload: unknown): string | null {
  if (structuredOutput && typeof structuredOutput.spec_markdown === 'string' && structuredOutput.spec_markdown.trim()) {
    return structuredOutput.spec_markdown;
  }
  if (typeof responsePayload === 'string' && responsePayload.trim().startsWith('#')) {
    return responsePayload;
  }
  return null;
}

export class RootSpecAuthorAgent implements Agent<RootSpecAuthorInput, RootSpecAuthorOutput> {
  readonly name = 'root_spec_author_agent' as const;

  constructor(
    private readonly backendRegistry = new AgentBackendRegistry()
  ) {}

  async canRun(context: AgentContext): Promise<boolean> {
    return context.envelope.constraints.canEditSpecs;
  }

  async run(
    input: RootSpecAuthorInput,
    context: AgentContext
  ): Promise<AgentResultEnvelope<RootSpecAuthorOutput>> {
    const backendInvocation = await this.invokeConfiguredBackend(input, context);
    const fallback = buildFallbackSpec(input, context);
    const specMarkdown = readSpecMarkdown(backendInvocation.structured_output ?? null, backendInvocation.response_payload)
      ?? fallback.spec_markdown;
    const assumptions = asStringArray(backendInvocation.structured_output?.assumptions).length > 0
      ? asStringArray(backendInvocation.structured_output?.assumptions)
      : fallback.metadata.assumptions;
    const openQuestions = asStringArray(backendInvocation.structured_output?.open_questions).length > 0
      ? asStringArray(backendInvocation.structured_output?.open_questions)
      : fallback.metadata.open_questions;
    const detectedTbdCount = typeof backendInvocation.structured_output?.detected_tbd_count === 'number'
      ? backendInvocation.structured_output.detected_tbd_count
      : (specMarkdown.match(/\bTBD\b/g) ?? []).length;

    const output: RootSpecAuthorOutput = {
      spec_markdown: specMarkdown.endsWith('\n') ? specMarkdown : `${specMarkdown}\n`,
      metadata: {
        spec_id: fallback.metadata.spec_id,
        assumptions,
        open_questions: openQuestions,
        detected_tbd_count: detectedTbdCount,
        evidence_refs: fallback.metadata.evidence_refs,
      },
      backend_invocation: backendInvocation,
    };

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output,
      artifact_refs: [],
      human_questions: openQuestions,
      recommended_next_action: 'RUN_ROOT_SPEC_CRITIC_AGENT',
    };
  }

  private async invokeConfiguredBackend(
    input: RootSpecAuthorInput,
    context: AgentContext
  ): Promise<RootSpecBackendInvocation> {
    const resolvedBackend = this.backendRegistry.resolveForAgent(this.name, { allowDefaultFallback: false });
    if (!resolvedBackend) {
      return {
        configured: false,
        mode: 'none',
        status: 'NOT_CONFIGURED',
        notes: [],
      };
    }

    const taskPrompt = [
      '# Root Spec Target',
      `Ticket: ${context.envelope.ticket_key}`,
      `Summary: ${context.ticket.summary ?? '(no summary)'}`,
      '',
      '# Normalized Context',
      stringifyJson(summarizeNormalizedContext(input.normalized_context)),
      '',
      '# Project Evidence',
      stringifyJson(summarizeProjectEvidence(input.project_evidence)),
      '',
      '# Human Clarifications',
      input.clarification_notes.length > 0
        ? input.clarification_notes.map((note) => `- ${note}`).join('\n')
        : '- None',
      '',
      '# Prior Root Spec Review',
      input.previous_review
        ? stringifyJson(input.previous_review)
        : 'None',
      '',
      '# Instructions',
      '- Preserve every observable acceptance criterion already present in the normalized context.',
      '- Use TBD explicitly when a business definition is still missing.',
      '- Resolve technical contracts, schema hints, and affected layers using the provided project evidence when possible.',
      '- Return JSON only with spec_markdown, assumptions, open_questions, detected_tbd_count.',
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
        system_prompt: ROOT_SPEC_AUTHOR_SYSTEM_PROMPT,
        task_prompt: taskPrompt,
        metadata: {
          input_refs: context.envelope.input_refs,
          clarification_notes: input.clarification_notes,
          impacted_layers: input.project_evidence.impacted_layers,
          api_contract_refs: input.project_evidence.api_contract_refs,
          data_model_refs: input.project_evidence.data_model_refs,
        },
      });
      return this.toBackendInvocation(result);
    } catch (error) {
      return {
        configured: true,
        backend_name: resolvedBackend.name,
        mode: resolvedBackend.config.mode,
        status: 'FAILED',
        system_prompt: ROOT_SPEC_AUTHOR_SYSTEM_PROMPT,
        task_prompt: taskPrompt,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private toBackendInvocation(result: AgentInvocationResult): RootSpecBackendInvocation {
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
