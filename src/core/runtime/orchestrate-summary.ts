import type { RuntimeExplainResult } from './explain.js';
import type { AgentExecutionSummary, OrchestrationStage } from './orchestration/AgentOrchestrator.js';

export interface OrchestrateTerminalSummaryInput {
  requestedStage: OrchestrationStage;
  executionSummaries: AgentExecutionSummary[];
  explanation: RuntimeExplainResult;
}

function formatState(value: string | null | undefined): string {
  return value ?? 'none';
}

function isRetryableFailure(explanation: RuntimeExplainResult): boolean {
  return explanation.snapshot?.ticket_state === 'VALIDATION_FAILED'
    || explanation.snapshot?.current_cycle?.state === 'FAILED_RETRYABLE';
}

function isEscalated(explanation: RuntimeExplainResult): boolean {
  return explanation.snapshot?.ticket_state === 'HUMAN_ESCALATION_REQUIRED'
    || explanation.snapshot?.session_state === 'AWAITING_HUMAN'
    || explanation.snapshot?.current_cycle?.state === 'FAILED_ESCALATED';
}

function summarizeResult(input: OrchestrateTerminalSummaryInput): string {
  const { executionSummaries, explanation } = input;
  const lastSummary = executionSummaries.at(-1);
  const lastAgent = lastSummary?.agent ?? 'the runtime';

  if (executionSummaries.length === 0) {
    return 'No new agents executed.';
  }

  if (explanation.pending_approvals.length > 0) {
    return `Approval gating after ${lastAgent}.`;
  }

  if (isRetryableFailure(explanation)) {
    return `Retryable failure after ${lastAgent}.`;
  }

  if (isEscalated(explanation)) {
    return `Escalated after ${lastAgent}.`;
  }

  return `Executed ${executionSummaries.length} agent${executionSummaries.length === 1 ? '' : 's'} through ${lastAgent}.`;
}

export function buildOrchestrateTerminalSummaryLines(
  input: OrchestrateTerminalSummaryInput
): string[] {
  const { requestedStage, executionSummaries, explanation } = input;
  const lastSummary = executionSummaries.at(-1);
  const firstApproval = explanation.pending_approvals[0];
  const lines = [
    'Orchestration summary',
    `Requested stage: ${requestedStage}`,
    `Result: ${summarizeResult(input)}`,
  ];

  if (!explanation.found || !explanation.snapshot || !explanation.explanation || !explanation.suggested_next_action) {
    if (executionSummaries.length === 0) {
      lines.push(`Reason: The runtime is already beyond the requested stage "${requestedStage}".`);
    } else {
      lines.push(`Last agent: ${lastSummary?.agent ?? 'unknown'} (${lastSummary?.status ?? 'unknown'})`);
    }
    lines.push(explanation.message);
    return lines;
  }

  if (executionSummaries.length === 0) {
    lines.push(`Reason: The runtime is already beyond the requested stage "${requestedStage}".`);
    lines.push('Last agent: none');
  } else {
    lines.push(`Last agent: ${lastSummary?.agent ?? 'unknown'} (${lastSummary?.status ?? 'unknown'})`);
  }

  lines.push(`Ticket: ${explanation.snapshot.ticket}`);
  if (explanation.snapshot.change) {
    lines.push(`Change: ${explanation.snapshot.change}`);
  }
  lines.push(`Ticket state: ${explanation.snapshot.ticket_state}`);
  lines.push(`Session state: ${explanation.snapshot.session_state}`);
  lines.push(`Change state: ${formatState(explanation.snapshot.change_state)}`);
  lines.push(`Cycle state: ${formatState(explanation.snapshot.current_cycle?.state)}`);
  lines.push(`Why: ${explanation.explanation.primary_reason ?? 'No blocking signal is active.'}`);

  if (firstApproval) {
    lines.push(`Pending approval: ${firstApproval.approval_id} [${firstApproval.scope}]`);
    lines.push(`Approval show: ${firstApproval.suggested_commands.show}`);
    lines.push(`Approval accept: ${firstApproval.suggested_commands.accept}`);
    lines.push(`Approval reject: ${firstApproval.suggested_commands.reject}`);
    lines.push(`Primary evidence: approval ${firstApproval.approval_id} [${firstApproval.scope}]`);
    if (explanation.primary_evidence_ref) {
      lines.push(`Evidence artifact: ${explanation.primary_evidence_ref}`);
    }
  } else if (explanation.primary_evidence_ref) {
    lines.push(`Primary evidence: ${explanation.primary_evidence_ref}`);
  }

  lines.push(`Next step: ${explanation.suggested_next_action.summary}`);
  if (!firstApproval && explanation.suggested_next_action.command) {
    lines.push(`Suggested command: ${explanation.suggested_next_action.command}`);
  }

  return lines;
}

export function printOrchestrateTerminalSummary(
  input: OrchestrateTerminalSummaryInput
): void {
  for (const line of buildOrchestrateTerminalSummaryLines(input)) {
    console.log(line);
  }
}
