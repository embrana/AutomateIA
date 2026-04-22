import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';
import type { CriticAgentOutput } from '../critic/CriticAgent.js';
import type { ImplementationAgentOutput } from '../implementation/ImplementationAgent.js';
import type { ExecutionPlan } from '../planning/PlanningAgent.js';
import type { ValidationAgentOutput } from '../validation/ValidationAgent.js';

export interface DeliveryClosureSummary {
  completed_scope: string[];
  remaining_risks: string[];
  worklog_preview: string[];
}

export interface DeliveryAgentInput {
  normalized_context: NormalizedContext;
  execution_plan: ExecutionPlan;
  implementation_report: ImplementationAgentOutput;
  critic_report: CriticAgentOutput;
  validation_report: ValidationAgentOutput;
}

export interface DeliveryAgentOutput {
  archive_ready: boolean;
  archive_allowed: boolean;
  worklog_allowed: boolean;
  approval_required: boolean;
  blocking_reasons: string[];
  jira_comment: string;
  closure_summary: DeliveryClosureSummary;
}

function summarizeWorklog(context: AgentContext): string[] {
  const blocks = context.timerSession.blocks ?? [];
  if (blocks.length === 0 && context.timerSession.current_block) {
    return [
      `${context.timerSession.current_block.work_kind}: ${context.timerSession.current_block.description}`,
    ];
  }
  return blocks.map((block) => `${block.work_kind}: ${block.description}`);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export class DeliveryAgent implements Agent<DeliveryAgentInput, DeliveryAgentOutput> {
  readonly name = 'delivery_agent' as const;

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.runtimeSnapshot.session.change_name);
  }

  async run(
    input: DeliveryAgentInput,
    context: AgentContext
  ): Promise<AgentResultEnvelope<DeliveryAgentOutput>> {
    const archiveReady = input.validation_report.validation_result === 'PASSED';
    const worklogAllowed = true;
    const approvalRequired = archiveReady && (
      context.envelope.autonomy_level === 'L0_OBSERVE'
      || context.envelope.autonomy_level === 'L1_DRAFT'
      || context.envelope.autonomy_level === 'L2_ASSISTED'
    );

    const blockingReasons = [
      ...(!archiveReady ? input.validation_report.reasons : []),
      ...(approvalRequired ? ['Archive requires human approval under the current autonomy policy.'] : []),
    ];

    const completedScope = unique([
      ...input.implementation_report.tasks_completed.map((taskId) => `Plan step ${taskId} completed`),
      ...input.implementation_report.changes_applied.map((change) => `Updated ${change.file}`),
    ]);
    const remainingRisks = unique([
      ...input.normalized_context.ambiguities,
      ...input.implementation_report.known_limitations,
      ...input.critic_report.findings.map((finding) => finding.message),
      ...blockingReasons,
    ]);
    const jiraComment = [
      `Runtime delivery summary for ${context.ticket.key}:`,
      completedScope.length > 0
        ? `Completed ${completedScope.length} implementation item(s).`
        : 'No completed implementation items were detected.',
      input.validation_report.validation_result === 'PASSED'
        ? 'Validation passed for the active change.'
        : `Validation result: ${input.validation_report.failure_classification}.`,
      approvalRequired
        ? 'Archive remains gated until a human approves closeout.'
        : archiveReady
          ? 'Archive is ready under the current runtime policy.'
          : 'Archive is not ready yet.',
    ].join(' ');

    const output: DeliveryAgentOutput = {
      archive_ready: archiveReady,
      archive_allowed: archiveReady && !approvalRequired,
      worklog_allowed: worklogAllowed,
      approval_required: approvalRequired,
      blocking_reasons: blockingReasons,
      jira_comment: jiraComment,
      closure_summary: {
        completed_scope: completedScope,
        remaining_risks: remainingRisks,
        worklog_preview: summarizeWorklog(context),
      },
    };

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output,
      artifact_refs: [],
      recommended_next_action: approvalRequired ? 'REQUEST_ARCHIVE_APPROVAL' : 'STOP',
    };
  }
}
