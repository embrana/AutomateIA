import type { TimerActorMode, TimerSession, TimerWorkKind } from '../timer/types.js';

export const RUNTIME_LAYOUT_VERSION = 1;

export type AutonomyLevel =
  | 'L0_OBSERVE'
  | 'L1_DRAFT'
  | 'L2_ASSISTED'
  | 'L3_SUPERVISED_AUTONOMY'
  | 'L4_HIGH_AUTONOMY';

export type TicketRuntimeState =
  | 'DISCOVERED'
  | 'CONTEXT_IMPORTED'
  | 'DISCOVERY_IN_PROGRESS'
  | 'ROOT_SPEC_REVIEW'
  | 'SPEC_READY'
  | 'PLANNED'
  | 'IN_EXECUTION'
  | 'UNDER_REVIEW'
  | 'VALIDATION_FAILED'
  | 'READY_FOR_ARCHIVE'
  | 'ARCHIVED'
  | 'BLOCKED'
  | 'HUMAN_ESCALATION_REQUIRED';

export type SessionRuntimeState =
  | 'IDLE'
  | 'ACTIVE'
  | 'PAUSED'
  | 'SWITCHING_BLOCK'
  | 'AWAITING_HUMAN'
  | 'SYNC_PENDING'
  | 'CLOSED'
  | 'CANCELLED'
  | 'FAILED';

export type ChangeRuntimeState =
  | 'NOT_CREATED'
  | 'DRAFTED'
  | 'TASKED'
  | 'IN_IMPLEMENTATION'
  | 'UNDER_REVIEW'
  | 'VALIDATED'
  | 'ARCHIVE_BLOCKED'
  | 'ARCHIVED';

export type ExecutionCycleState =
  | 'QUEUED'
  | 'RUNNING'
  | 'UNDER_REVIEW'
  | 'VALIDATING'
  | 'FAILED_RETRYABLE'
  | 'FAILED_ESCALATED'
  | 'PASSED'
  | 'CANCELLED';

export type AgentRunState =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REJECTED'
  | 'ESCALATED'
  | 'SKIPPED';

export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'BLOCKED';
export type RuntimeActivityMode = TimerActorMode | 'none';
export type RuntimeWorkKind = TimerWorkKind | 'none';
export type ApprovalScope = 'root_spec' | 'plan' | 'implementation' | 'archive' | 'jira_comment' | 'recovery';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface RuntimeFileBase {
  runtime_version: number;
  created_at: string;
  updated_at: string;
}

export interface TicketRuntime extends RuntimeFileBase {
  ticket_key: string;
  state: TicketRuntimeState;
  summary?: string;
  jira_status?: string | null;
  assignee?: string | null;
  source_url?: string;
  active_session_id?: string;
  active_change_name?: string;
}

export interface SessionRuntime extends RuntimeFileBase {
  session_id: string;
  ticket_key: string;
  developer_id: string;
  started_at: string;
  ended_at?: string | null;
  state: SessionRuntimeState;
  command: TimerSession['command'];
  cwd: string;
  change_name?: string;
  autonomy_level: AutonomyLevel;
  active_mode: RuntimeActivityMode;
  active_kind: RuntimeWorkKind;
  worklog_status?: TimerSession['worklog_status'];
  sync_error?: string;
  current_cycle: number;
  last_timer_status: TimerSession['status'];
}

export interface ChangeRuntime extends RuntimeFileBase {
  change_name: string;
  ticket_key: string;
  proposal_path?: string;
  tasks_path?: string;
  jira_ticket_path?: string;
  spec_path?: string;
  state: ChangeRuntimeState;
  validation_status: ValidationStatus;
  archive_eligible: boolean;
  worklog_eligible?: boolean;
  archive_name?: string;
  last_archive_reason?: string;
}

export interface ExecutionCycle extends RuntimeFileBase {
  cycle_id: string;
  session_id: string;
  ticket_key: string;
  change_name?: string;
  iteration_no: number;
  started_at: string;
  ended_at?: string | null;
  state: ExecutionCycleState;
  initiated_by: 'human' | 'system' | 'agent';
  trigger_reason?: string;
}

export interface AgentRun extends RuntimeFileBase {
  agent_run_id: string;
  agent_name: string;
  session_id: string;
  ticket_key: string;
  cycle_id?: string;
  status: AgentRunState;
  input_ref?: string;
  output_ref?: string;
  started_at: string;
  ended_at?: string | null;
}

export interface ApprovalRequest extends RuntimeFileBase {
  approval_id: string;
  ticket_key: string;
  session_id: string;
  change_name?: string;
  scope: ApprovalScope;
  reason: string;
  evidence_refs: string[];
  status: ApprovalStatus;
  created_at: string;
  resolved_at?: string | null;
  resolution_reason?: string;
}

export interface RuntimeSnapshot {
  source: 'active_timer' | 'latest_runtime';
  runtime_root: string;
  ticket: TicketRuntime;
  session: SessionRuntime;
  change?: ChangeRuntime;
}
