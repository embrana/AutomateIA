import { parseStructuredSdd } from '../../core/timer/ticket-change.js';
import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';

export interface ContextAgentOutput {
  normalized_context: NormalizedContext;
}

function splitLines(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function detectIntegrations(text: string): string[] {
  const integrations = [
    ['jira', 'Jira'],
    ['tempo', 'Tempo'],
    ['git', 'Git'],
    ['github', 'GitHub'],
    ['api', 'API'],
    ['ci', 'CI'],
    ['filesystem', 'Filesystem'],
  ] as const;

  const haystack = text.toLowerCase();
  return integrations.filter(([needle]) => haystack.includes(needle)).map(([, label]) => label);
}

function detectRisks(text: string): string[] {
  const riskMatchers = [
    ['auth', 'Touches authentication-sensitive behavior'],
    ['payment', 'Touches payment-sensitive behavior'],
    ['migration', 'May involve migration or data movement'],
    ['archive', 'Impacts archive and closeout flow'],
    ['worklog', 'Impacts Jira worklog synchronization'],
    ['runtime', 'Impacts shared runtime state and orchestration'],
  ] as const;
  const haystack = text.toLowerCase();
  return riskMatchers.filter(([needle]) => haystack.includes(needle)).map(([, label]) => label);
}

export class ContextAgent implements Agent<void, ContextAgentOutput> {
  readonly name = 'context_agent' as const;

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.ticket.key);
  }

  async run(_: void, context: AgentContext): Promise<AgentResultEnvelope<ContextAgentOutput>> {
    const structured = parseStructuredSdd(context.ticket.description_text, context.ticket.summary || context.ticket.key);
    const description = context.ticket.description_text.trim();
    const ambiguities: string[] = [];

    let normalizedContext: NormalizedContext;
    if (structured) {
      normalizedContext = {
        problem_statement: structured.context || structured.goals || context.ticket.summary,
        acceptance_criteria: structured.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.title}`),
        business_rules: splitLines(structured.businessRules),
        data_contracts: splitLines(structured.domainContracts),
        integrations: dedupe([
          ...detectIntegrations(structured.domainContracts),
          ...detectIntegrations(context.ticket.description_text),
        ]),
        out_of_scope: dedupe([
          ...splitLines(structured.nonGoals),
          ...splitLines(structured.outOfScope),
        ]),
        ambiguities,
        risks: dedupe(detectRisks(context.ticket.description_text)),
        source_summary: context.ticket.summary,
      };
    } else {
      const inferredCriteria = description
        ? description
          .split(/\n{2,}/)
          .map((block) => block.trim())
          .filter(Boolean)
          .slice(0, 5)
        : [];
      if (inferredCriteria.length === 0) {
        ambiguities.push('Ticket description does not provide structured acceptance criteria.');
      } else {
        ambiguities.push('Acceptance criteria were inferred from an unstructured Jira description.');
      }

      normalizedContext = {
        problem_statement: context.ticket.summary,
        acceptance_criteria: inferredCriteria.length > 0 ? inferredCriteria : [`Implement the request described by Jira issue ${context.ticket.key}.`],
        business_rules: [],
        data_contracts: [],
        integrations: dedupe(detectIntegrations(context.ticket.description_text)),
        out_of_scope: [],
        ambiguities,
        risks: dedupe([
          ...detectRisks(context.ticket.description_text),
          'Ticket does not include structured SDD sections.',
        ]),
        source_summary: context.ticket.summary,
      };
    }

    if (context.projectConfig?.context) {
      normalizedContext.problem_statement = `${normalizedContext.problem_statement}\n\nProject context:\n${context.projectConfig.context.trim()}`;
    }

    const summaryLines = [
      `# Context Summary`,
      ``,
      `Ticket: ${context.ticket.key}`,
      `Summary: ${context.ticket.summary}`,
      ``,
      `## Problem Statement`,
      normalizedContext.problem_statement || 'Not provided.',
      ``,
      `## Acceptance Criteria`,
      ...(normalizedContext.acceptance_criteria.length > 0
        ? normalizedContext.acceptance_criteria.map((item) => `- ${item}`)
        : ['- None identified']),
      ``,
      `## Business Rules`,
      ...(normalizedContext.business_rules.length > 0
        ? normalizedContext.business_rules.map((item) => `- ${item}`)
        : ['- None identified']),
      ``,
      `## Data Contracts`,
      ...(normalizedContext.data_contracts.length > 0
        ? normalizedContext.data_contracts.map((item) => `- ${item}`)
        : ['- None identified']),
      ``,
      `## Integrations`,
      ...(normalizedContext.integrations.length > 0
        ? normalizedContext.integrations.map((item) => `- ${item}`)
        : ['- None identified']),
      ``,
      `## Out Of Scope`,
      ...(normalizedContext.out_of_scope.length > 0
        ? normalizedContext.out_of_scope.map((item) => `- ${item}`)
        : ['- None identified']),
      ``,
      `## Ambiguities`,
      ...(normalizedContext.ambiguities.length > 0
        ? normalizedContext.ambiguities.map((item) => `- ${item}`)
        : ['- None identified']),
      ``,
      `## Risks`,
      ...(normalizedContext.risks.length > 0
        ? normalizedContext.risks.map((item) => `- ${item}`)
        : ['- None identified']),
      ``,
    ].join('\n');

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output: {
        normalized_context: normalizedContext,
      },
      artifact_refs: [],
      human_questions: normalizedContext.ambiguities,
      recommended_next_action: 'RUN_PROJECT_EVIDENCE_RESOLVER_AGENT',
    };
  }
}
