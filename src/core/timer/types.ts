export type WorklogRoundingMode = 'minute' | 'none';
export type TimerActorMode = 'human' | 'ai_autonomous' | 'human_agent_interaction';
export type TimerWorkKind = 'implementation' | 'spec' | 'review' | 'bugfix' | 'rework' | 'testing' | 'other';
export type TimerBlockSource = 'auto' | 'manual';

export interface JiraConfig {
  base_url?: string;
  email?: string;
  api_token?: string;
  default_project?: string;
}

export interface WorklogConfig {
  author_display?: string;
  rounding?: WorklogRoundingMode;
  min_seconds?: number;
  comment_template?: string;
  track_metadata_locally?: boolean;
}

export interface ImportedJiraTicket {
  key: string;
  summary: string;
  status: string | null;
  assignee: string | null;
  description_text: string;
  url: string;
}

export interface JiraTicketSummary {
  key: string;
  summary: string;
  status: string | null;
  assignee: string | null;
  url: string;
}

export interface TimerPauseEvent {
  paused_at: string;
  paused_at_local: string;
  resumed_at?: string;
  resumed_at_local?: string;
  duration_seconds?: number;
}

export interface TimerBlock {
  block_id: string;
  actor_mode: TimerActorMode;
  work_kind: TimerWorkKind;
  description: string;
  source: TimerBlockSource;
  started_at: string;
  started_at_local: string;
  ended_at?: string;
  ended_at_local?: string;
  raw_duration_seconds?: number;
}

export interface JiraWorklogSyncResult {
  block_key: string;
  actor_mode: TimerActorMode;
  work_kind: TimerWorkKind;
  description: string;
  started_at: string;
  started_at_local: string;
  raw_duration_seconds: number;
  rounded_duration_seconds: number;
  jira_worklog_id?: string;
  status: 'pending' | 'synced';
  sync_error?: string;
}

export interface TimerSession {
  session_id: string;
  jira_issue_key: string;
  jira_ticket?: ImportedJiraTicket;
  openspec_change?: {
    name: string;
    path: string;
    schema: string;
  };
  started_at: string;
  started_at_local: string;
  user_email: string;
  status: 'running' | 'paused' | 'sync_pending' | 'closed';
  command: 'purpose' | 'timer_start';
  cwd: string;
  notes: string | null;
  paused_at?: string;
  paused_at_local?: string;
  paused_duration_seconds?: number;
  pause_events?: TimerPauseEvent[];
  current_block?: TimerBlock;
  blocks?: TimerBlock[];
  jira_worklogs?: JiraWorklogSyncResult[];
  ended_at?: string;
  ended_at_local?: string;
  raw_duration_seconds?: number;
  rounded_duration_seconds?: number;
  worklog_status?: 'pending' | 'synced';
  jira_worklog_id?: string;
  comment?: string;
  sync_error?: string;
}
