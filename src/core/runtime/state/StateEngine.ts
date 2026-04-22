import type {
  AgentRunState,
  ChangeRuntimeState,
  ExecutionCycleState,
  SessionRuntimeState,
  TicketRuntimeState,
} from '../types.js';

function asSet<T extends string>(values: T[]): Set<T> {
  return new Set(values);
}

const SESSION_TRANSITIONS: Record<SessionRuntimeState, Set<SessionRuntimeState>> = {
  IDLE: asSet(['ACTIVE']),
  ACTIVE: asSet(['ACTIVE', 'PAUSED', 'SWITCHING_BLOCK', 'AWAITING_HUMAN', 'SYNC_PENDING', 'CLOSED', 'CANCELLED', 'FAILED']),
  PAUSED: asSet(['PAUSED', 'ACTIVE', 'CANCELLED', 'FAILED', 'SYNC_PENDING', 'CLOSED']),
  SWITCHING_BLOCK: asSet(['SWITCHING_BLOCK', 'ACTIVE', 'FAILED']),
  AWAITING_HUMAN: asSet(['AWAITING_HUMAN', 'ACTIVE', 'FAILED', 'CANCELLED']),
  SYNC_PENDING: asSet(['SYNC_PENDING', 'CLOSED', 'FAILED', 'CANCELLED']),
  CLOSED: asSet(['CLOSED']),
  CANCELLED: asSet(['CANCELLED']),
  FAILED: asSet(['FAILED', 'ACTIVE']),
};

const TICKET_TRANSITIONS: Record<TicketRuntimeState, Set<TicketRuntimeState>> = {
  DISCOVERED: asSet(['DISCOVERED', 'CONTEXT_IMPORTED', 'SPEC_READY', 'BLOCKED', 'ARCHIVED']),
  CONTEXT_IMPORTED: asSet(['CONTEXT_IMPORTED', 'SPEC_READY', 'PLANNED', 'BLOCKED', 'ARCHIVED']),
  SPEC_READY: asSet(['SPEC_READY', 'PLANNED', 'IN_EXECUTION', 'READY_FOR_ARCHIVE', 'HUMAN_ESCALATION_REQUIRED', 'BLOCKED', 'ARCHIVED']),
  PLANNED: asSet(['PLANNED', 'IN_EXECUTION', 'UNDER_REVIEW', 'VALIDATION_FAILED', 'READY_FOR_ARCHIVE', 'HUMAN_ESCALATION_REQUIRED', 'BLOCKED', 'ARCHIVED']),
  IN_EXECUTION: asSet(['IN_EXECUTION', 'UNDER_REVIEW', 'VALIDATION_FAILED', 'HUMAN_ESCALATION_REQUIRED', 'BLOCKED', 'ARCHIVED']),
  UNDER_REVIEW: asSet(['UNDER_REVIEW', 'VALIDATION_FAILED', 'READY_FOR_ARCHIVE', 'HUMAN_ESCALATION_REQUIRED', 'BLOCKED', 'ARCHIVED']),
  VALIDATION_FAILED: asSet(['VALIDATION_FAILED', 'IN_EXECUTION', 'BLOCKED', 'HUMAN_ESCALATION_REQUIRED']),
  READY_FOR_ARCHIVE: asSet(['READY_FOR_ARCHIVE', 'ARCHIVED', 'HUMAN_ESCALATION_REQUIRED', 'BLOCKED']),
  ARCHIVED: asSet(['ARCHIVED']),
  BLOCKED: asSet(['BLOCKED', 'PLANNED', 'IN_EXECUTION', 'READY_FOR_ARCHIVE', 'HUMAN_ESCALATION_REQUIRED', 'ARCHIVED']),
  HUMAN_ESCALATION_REQUIRED: asSet(['HUMAN_ESCALATION_REQUIRED', 'IN_EXECUTION', 'READY_FOR_ARCHIVE', 'ARCHIVED', 'BLOCKED', 'PLANNED']),
};

const CHANGE_TRANSITIONS: Record<ChangeRuntimeState, Set<ChangeRuntimeState>> = {
  NOT_CREATED: asSet(['NOT_CREATED', 'DRAFTED', 'TASKED']),
  DRAFTED: asSet(['DRAFTED', 'TASKED', 'ARCHIVE_BLOCKED', 'ARCHIVED']),
  TASKED: asSet(['TASKED', 'IN_IMPLEMENTATION', 'UNDER_REVIEW', 'ARCHIVE_BLOCKED', 'ARCHIVED']),
  IN_IMPLEMENTATION: asSet(['IN_IMPLEMENTATION', 'UNDER_REVIEW', 'ARCHIVE_BLOCKED', 'ARCHIVED']),
  UNDER_REVIEW: asSet(['UNDER_REVIEW', 'IN_IMPLEMENTATION', 'VALIDATED', 'ARCHIVE_BLOCKED', 'ARCHIVED']),
  VALIDATED: asSet(['VALIDATED', 'ARCHIVED', 'ARCHIVE_BLOCKED']),
  ARCHIVE_BLOCKED: asSet(['ARCHIVE_BLOCKED', 'IN_IMPLEMENTATION', 'UNDER_REVIEW', 'VALIDATED', 'ARCHIVED']),
  ARCHIVED: asSet(['ARCHIVED']),
};

const CYCLE_TRANSITIONS: Record<ExecutionCycleState, Set<ExecutionCycleState>> = {
  QUEUED: asSet(['QUEUED', 'RUNNING', 'CANCELLED']),
  RUNNING: asSet(['RUNNING', 'UNDER_REVIEW', 'FAILED_RETRYABLE', 'FAILED_ESCALATED', 'CANCELLED']),
  UNDER_REVIEW: asSet(['UNDER_REVIEW', 'VALIDATING', 'FAILED_RETRYABLE', 'FAILED_ESCALATED', 'CANCELLED']),
  VALIDATING: asSet(['VALIDATING', 'FAILED_RETRYABLE', 'FAILED_ESCALATED', 'PASSED', 'CANCELLED']),
  FAILED_RETRYABLE: asSet(['FAILED_RETRYABLE', 'RUNNING', 'CANCELLED']),
  FAILED_ESCALATED: asSet(['FAILED_ESCALATED', 'RUNNING', 'CANCELLED']),
  PASSED: asSet(['PASSED']),
  CANCELLED: asSet(['CANCELLED']),
};

const AGENT_RUN_TRANSITIONS: Record<AgentRunState, Set<AgentRunState>> = {
  QUEUED: asSet(['QUEUED', 'RUNNING', 'REJECTED', 'SKIPPED']),
  RUNNING: asSet(['RUNNING', 'SUCCEEDED', 'FAILED', 'ESCALATED']),
  SUCCEEDED: asSet(['SUCCEEDED']),
  FAILED: asSet(['FAILED']),
  REJECTED: asSet(['REJECTED']),
  ESCALATED: asSet(['ESCALATED']),
  SKIPPED: asSet(['SKIPPED']),
};

export class StateEngine {
  assertSessionTransition(previous: SessionRuntimeState | undefined, next: SessionRuntimeState): void {
    this.assertTransition('session', SESSION_TRANSITIONS, previous, next);
  }

  assertTicketTransition(previous: TicketRuntimeState | undefined, next: TicketRuntimeState): void {
    this.assertTransition('ticket', TICKET_TRANSITIONS, previous, next);
  }

  assertChangeTransition(previous: ChangeRuntimeState | undefined, next: ChangeRuntimeState): void {
    this.assertTransition('change', CHANGE_TRANSITIONS, previous, next);
  }

  assertCycleTransition(previous: ExecutionCycleState | undefined, next: ExecutionCycleState): void {
    this.assertTransition('cycle', CYCLE_TRANSITIONS, previous, next);
  }

  assertAgentRunTransition(previous: AgentRunState | undefined, next: AgentRunState): void {
    this.assertTransition('agent run', AGENT_RUN_TRANSITIONS, previous, next);
  }

  private assertTransition<T extends string>(
    label: string,
    transitions: Record<T, Set<T>>,
    previous: T | undefined,
    next: T
  ): void {
    if (!previous || previous === next) {
      return;
    }

    const allowed = transitions[previous];
    if (!allowed?.has(next)) {
      throw new Error(`Invalid ${label} state transition: ${previous} -> ${next}`);
    }
  }
}
