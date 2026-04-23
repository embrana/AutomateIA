import { describe, expect, it } from 'vitest';
import type { RuntimeExplainResult } from '../../../src/core/runtime/explain.js';
import { buildOrchestrateTerminalSummaryLines } from '../../../src/core/runtime/orchestrate-summary.js';

function createExplanation(overrides: Partial<RuntimeExplainResult> = {}): RuntimeExplainResult {
  return {
    found: true,
    message: 'OpenSpec runtime explanation for PROJ-123',
    source: 'latest_runtime',
    runtime_root: '.openspec/runtime/tickets/PROJ-123',
    snapshot: {
      ticket: 'PROJ-123',
      summary: 'Seeded runtime',
      ticket_state: 'PLANNED',
      session_id: 'sess-1',
      session_state: 'ACTIVE',
      change: 'runtime-change',
      change_state: 'TASKED',
      validation_status: 'PENDING',
      archive_eligible: false,
      worklog_eligible: true,
      current_cycle: null,
      updated_at: '2026-04-23T00:00:00.000Z',
    },
    explanation: {
      summary: 'Ticket PROJ-123 is PLANNED.',
      primary_reason: 'The runtime is waiting for implementation to begin.',
    },
    blockers: [],
    pending_approvals: [],
    suggested_next_action: {
      route: 'implementation',
      summary: 'Start implementation for the planned change.',
      command: 'osj orchestrate --until implementation',
    },
    primary_evidence_ref: null,
    artifact_refs: [],
    ...overrides,
  };
}

describe('buildOrchestrateTerminalSummaryLines', () => {
  it('explains no-op runs explicitly when the runtime is already beyond the requested stage', () => {
    const lines = buildOrchestrateTerminalSummaryLines({
      requestedStage: 'planning',
      executionSummaries: [],
      explanation: createExplanation(),
    });

    expect(lines).toContain('Result: No new agents executed.');
    expect(lines).toContain('Reason: The runtime is already beyond the requested stage "planning".');
    expect(lines).toContain('Last agent: none');
    expect(lines).toContain('Ticket state: PLANNED');
    expect(lines).toContain('Session state: ACTIVE');
    expect(lines).toContain('Change state: TASKED');
    expect(lines).toContain('Cycle state: none');
    expect(lines).toContain('Suggested command: osj orchestrate --until implementation');
  });

  it('prioritizes approval evidence and commands when the runtime is gated', () => {
    const lines = buildOrchestrateTerminalSummaryLines({
      requestedStage: 'delivery',
      executionSummaries: [
        {
          agent: 'delivery_agent',
          status: 'SUCCEEDED',
          recommended_next_action: 'REQUEST_ARCHIVE_APPROVAL',
          artifact_refs: ['.openspec/runtime/tickets/PROJ-123/changes/runtime-change/delivery/archive-decision.json'],
        },
      ],
      explanation: createExplanation({
        snapshot: {
          ticket: 'PROJ-123',
          summary: 'Seeded runtime',
          ticket_state: 'HUMAN_ESCALATION_REQUIRED',
          session_id: 'sess-1',
          session_state: 'AWAITING_HUMAN',
          change: 'runtime-change',
          change_state: 'VALIDATED',
          validation_status: 'PASSED',
          archive_eligible: false,
          worklog_eligible: true,
          current_cycle: {
            id: 'cycle-001',
            state: 'PASSED',
            iteration: 1,
          },
          updated_at: '2026-04-23T00:00:00.000Z',
        },
        explanation: {
          summary: 'Ticket PROJ-123 is HUMAN_ESCALATION_REQUIRED.',
          primary_reason: 'Archive requires human approval under the current autonomy policy.',
        },
        pending_approvals: [
          {
            approval_id: 'approval-archive-1',
            scope: 'archive',
            change_name: 'runtime-change',
            reason: 'Archive requires human approval under the current autonomy policy.',
            evidence_refs: ['.openspec/runtime/tickets/PROJ-123/changes/runtime-change/delivery/closure-summary.json'],
            suggested_commands: {
              show: 'osj approval show',
              accept: 'osj approval accept approval-archive-1 --reason "approved by developer"',
              reject: 'osj approval reject approval-archive-1 --reason "rejected by developer"',
            },
          },
        ],
        suggested_next_action: {
          route: 'approval',
          summary: 'Resolve approval approval-archive-1 before continuing the runtime.',
          command: 'osj approval show',
        },
        primary_evidence_ref: '.openspec/runtime/tickets/PROJ-123/changes/runtime-change/delivery/closure-summary.json',
        artifact_refs: ['.openspec/runtime/tickets/PROJ-123/changes/runtime-change/delivery/closure-summary.json'],
      }),
    });

    expect(lines).toContain('Result: Approval gating after delivery_agent.');
    expect(lines).toContain('Pending approval: approval-archive-1 [archive]');
    expect(lines).toContain('Approval show: osj approval show');
    expect(lines).toContain('Approval accept: osj approval accept approval-archive-1 --reason "approved by developer"');
    expect(lines).toContain('Approval reject: osj approval reject approval-archive-1 --reason "rejected by developer"');
    expect(lines).toContain('Primary evidence: approval approval-archive-1 [archive]');
    expect(lines).toContain('Evidence artifact: .openspec/runtime/tickets/PROJ-123/changes/runtime-change/delivery/closure-summary.json');
  });

  it('summarizes escalations explicitly when the runtime needs human intervention without a pending approval', () => {
    const lines = buildOrchestrateTerminalSummaryLines({
      requestedStage: 'validation',
      executionSummaries: [
        {
          agent: 'validation_agent',
          status: 'SUCCEEDED',
          recommended_next_action: 'ESCALATE',
          artifact_refs: ['.openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json'],
        },
      ],
      explanation: createExplanation({
        snapshot: {
          ticket: 'PROJ-123',
          summary: 'Seeded runtime',
          ticket_state: 'HUMAN_ESCALATION_REQUIRED',
          session_id: 'sess-1',
          session_state: 'AWAITING_HUMAN',
          change: 'runtime-change',
          change_state: 'UNDER_REVIEW',
          validation_status: 'BLOCKED',
          archive_eligible: false,
          worklog_eligible: true,
          current_cycle: {
            id: 'cycle-003',
            state: 'FAILED_ESCALATED',
            iteration: 3,
          },
          updated_at: '2026-04-23T00:00:00.000Z',
        },
        explanation: {
          summary: 'Ticket PROJ-123 is HUMAN_ESCALATION_REQUIRED.',
          primary_reason: 'A human decision is required before validation can continue.',
        },
        suggested_next_action: {
          route: 'approval',
          summary: 'A human decision is required before the runtime can continue.',
          command: 'osj runtime explain',
        },
        primary_evidence_ref: '.openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json',
        artifact_refs: ['.openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json'],
      }),
    });

    expect(lines).toContain('Result: Escalated after validation_agent.');
    expect(lines).toContain('Ticket state: HUMAN_ESCALATION_REQUIRED');
    expect(lines).toContain('Session state: AWAITING_HUMAN');
    expect(lines).toContain('Cycle state: FAILED_ESCALATED');
    expect(lines).toContain('Why: A human decision is required before validation can continue.');
    expect(lines).toContain('Primary evidence: .openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json');
    expect(lines).toContain('Suggested command: osj runtime explain');
  });

  it('summarizes retryable failures with the rerun command from runtime explain', () => {
    const lines = buildOrchestrateTerminalSummaryLines({
      requestedStage: 'validation',
      executionSummaries: [
        {
          agent: 'implementation_agent',
          status: 'SUCCEEDED',
          recommended_next_action: 'RUN_CRITIC_AGENT',
          artifact_refs: [],
        },
        {
          agent: 'critic_agent',
          status: 'SUCCEEDED',
          recommended_next_action: 'RUN_VALIDATION_AGENT',
          artifact_refs: [],
        },
        {
          agent: 'validation_agent',
          status: 'SUCCEEDED',
          recommended_next_action: 'RUN_IMPLEMENTATION_AGENT',
          artifact_refs: ['.openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json'],
        },
      ],
      explanation: createExplanation({
        snapshot: {
          ticket: 'PROJ-123',
          summary: 'Seeded runtime',
          ticket_state: 'VALIDATION_FAILED',
          session_id: 'sess-1',
          session_state: 'ACTIVE',
          change: 'runtime-change',
          change_state: 'ARCHIVE_BLOCKED',
          validation_status: 'FAILED',
          archive_eligible: false,
          worklog_eligible: true,
          current_cycle: {
            id: 'cycle-002',
            state: 'FAILED_RETRYABLE',
            iteration: 2,
          },
          updated_at: '2026-04-23T00:00:00.000Z',
        },
        explanation: {
          summary: 'Ticket PROJ-123 is VALIDATION_FAILED.',
          primary_reason: 'Unit tests are still failing in the active change.',
        },
        blockers: [
          {
            kind: 'validation',
            title: 'Validation failed',
            reason: 'Unit tests are still failing in the active change.',
            state: 'RETRYABLE_IMPLEMENTATION_ERROR',
            artifact_ref: '.openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json',
          },
        ],
        suggested_next_action: {
          route: 'implementation',
          summary: 'Return to implementation, address the validation findings, and rerun the cycle.',
          command: 'osj orchestrate --until implementation',
        },
        primary_evidence_ref: '.openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json',
        artifact_refs: ['.openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json'],
      }),
    });

    expect(lines).toContain('Result: Retryable failure after validation_agent.');
    expect(lines).toContain('Cycle state: FAILED_RETRYABLE');
    expect(lines).toContain('Why: Unit tests are still failing in the active change.');
    expect(lines).toContain('Primary evidence: .openspec/runtime/tickets/PROJ-123/changes/runtime-change/validation/validation-result.json');
    expect(lines).toContain('Suggested command: osj orchestrate --until implementation');
  });
});
