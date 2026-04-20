export type WorklogRoundingMode = 'minute' | 'none';

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

export interface TimerPauseEvent {
  paused_at: string;
  paused_at_local: string;
  resumed_at?: string;
  resumed_at_local?: string;
  duration_seconds?: number;
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
  command: 'purpose';
  cwd: string;
  notes: string | null;
  paused_at?: string;
  paused_at_local?: string;
  paused_duration_seconds?: number;
  pause_events?: TimerPauseEvent[];
  ended_at?: string;
  ended_at_local?: string;
  raw_duration_seconds?: number;
  rounded_duration_seconds?: number;
  worklog_status?: 'pending' | 'synced';
  jira_worklog_id?: string;
  comment?: string;
  sync_error?: string;
}
