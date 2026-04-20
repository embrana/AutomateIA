import { randomUUID } from 'crypto';
import { getTimerConfig } from './config.js';
import {
  archiveSession,
  clearActiveSession,
  getActiveSession,
  saveActiveSession,
} from './store.js';
import {
  formatDuration,
  nowUtc,
  roundSeconds,
  secondsBetween,
  toLocalIso,
  toUtcIso,
} from './time.js';
import { JiraClient, resolveJiraConfig } from './jira-client.js';
import { createChangeFromTicket, fetchImportedJiraTicket } from './ticket-change.js';
import { buildAdfComment, buildWorklogPayload } from './worklog-payload.js';
import type { ImportedJiraTicket, TimerSession, WorklogConfig, WorklogRoundingMode } from './types.js';

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;
const DEFAULT_COMMENT = 'OpenSpec execution session';

export interface ArchiveTimerOptions {
  comment?: string;
  retry?: boolean;
  addJiraArchiveComment?: boolean;
}

export interface PurposeOptions {
  importTicket?: boolean;
  createChange?: boolean;
}

export function validateIssueKey(issueKey: string): void {
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    throw new Error(`Invalid Jira issue key: ${issueKey}`);
  }
}

function resolveWorklogConfig(worklog: WorklogConfig | undefined): Required<WorklogConfig> {
  return {
    author_display: worklog?.author_display ?? '',
    rounding: worklog?.rounding ?? 'minute',
    min_seconds: worklog?.min_seconds ?? 60,
    comment_template: worklog?.comment_template ?? DEFAULT_COMMENT,
    track_metadata_locally: worklog?.track_metadata_locally ?? true,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function syncWorklog(session: TimerSession, comment: string): Promise<Record<string, unknown>> {
  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  const jira = new JiraClient(jiraConfig);
  const payload = buildWorklogPayload(
    session.started_at_local,
    session.rounded_duration_seconds ?? 0,
    comment
  );
  return jira.createWorklog(session.jira_issue_key, payload);
}

async function addJiraComment(issueKey: string, text: string): Promise<Record<string, unknown>> {
  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  const jira = new JiraClient(jiraConfig);
  return jira.addComment(issueKey, { body: buildAdfComment(text) });
}

function buildArchiveSuccessComment(session: TimerSession): string {
  const lines = [
    'OpenSpec archive completed.',
    '',
    `Issue: ${session.jira_issue_key}`,
    session.openspec_change?.name ? `Change: ${session.openspec_change.name}` : undefined,
    `Duration: ${formatDuration(session.rounded_duration_seconds ?? 0)}`,
    session.jira_worklog_id ? `Jira worklog: ${session.jira_worklog_id}` : undefined,
    session.comment ? `Comment: ${session.comment}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

export async function addJiraArchiveComment(issueKey: string, text: string): Promise<void> {
  await addJiraComment(issueKey, text);
}

export async function hasTimerSession(): Promise<boolean> {
  return (await getActiveSession()) !== null;
}

export async function purpose(issueKey: string, options: PurposeOptions = {}): Promise<void> {
  validateIssueKey(issueKey);

  const existing = await getActiveSession();
  if (existing?.status === 'running' || existing?.status === 'paused') {
    throw new Error("There is already an active OpenSpec session.\nUse 'openspec archive' or 'openspec timer cancel'.");
  }
  if (existing?.status === 'sync_pending') {
    throw new Error("There is a pending OpenSpec worklog sync.\nUse 'openspec archive --retry' or 'openspec timer cancel'.");
  }

  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  let importedTicket: ImportedJiraTicket | undefined;
  let createdChange: TimerSession['openspec_change'] | undefined;

  if (options.importTicket || options.createChange) {
    importedTicket = await fetchImportedJiraTicket(issueKey);
  } else {
    const jira = new JiraClient(jiraConfig);
    await jira.getIssue(issueKey);
  }

  if (options.createChange) {
    const result = await createChangeFromTicket(importedTicket!);
    createdChange = {
      name: result.name,
      path: result.path,
      schema: result.schema,
    };
  }

  const started = nowUtc();
  const session: TimerSession = {
    session_id: randomUUID(),
    jira_issue_key: issueKey,
    jira_ticket: importedTicket,
    openspec_change: createdChange,
    started_at: toUtcIso(started),
    started_at_local: toLocalIso(started),
    user_email: jiraConfig.email,
    status: 'running',
    command: 'purpose',
    cwd: process.cwd(),
    notes: null,
    paused_duration_seconds: 0,
    pause_events: [],
  };

  await saveActiveSession(session);
  console.log(`Started OpenSpec session for ${issueKey} at ${session.started_at_local}`);
  if (importedTicket) {
    console.log(`Imported Jira ticket context: ${importedTicket.key} - ${importedTicket.summary}`);
  }
  if (createdChange) {
    console.log(`Created OpenSpec change '${createdChange.name}' at openspec/changes/${createdChange.name}/`);
  }
}

function getPauseSeconds(session: TimerSession, end: Date): number {
  const basePausedSeconds = session.paused_duration_seconds ?? 0;
  if (session.status !== 'paused' || !session.paused_at) {
    return basePausedSeconds;
  }
  return basePausedSeconds + secondsBetween(session.paused_at, end);
}

function getElapsedSeconds(session: TimerSession, end: Date): number {
  return Math.max(0, secondsBetween(session.started_at, end) - getPauseSeconds(session, end));
}

export async function archiveTimer(options: ArchiveTimerOptions = {}): Promise<TimerSession> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error('No active OpenSpec session found.');
  }

  const config = getTimerConfig();
  const worklogConfig = resolveWorklogConfig(config.worklog);
  const comment = options.comment ?? session.comment ?? worklogConfig.comment_template;

  if (session.status === 'sync_pending' && !options.retry) {
    throw new Error("OpenSpec session is pending Jira sync.\nUse 'openspec archive --retry' to retry or 'openspec timer cancel' to discard it.");
  }

  let sessionToSync = session;
  if (session.status === 'running' || session.status === 'paused') {
    const ended = nowUtc();
    const pausedSeconds = getPauseSeconds(session, ended);
    const rawSeconds = Math.max(0, secondsBetween(session.started_at, ended) - pausedSeconds);
    const roundedSeconds = roundSeconds(
      rawSeconds,
      worklogConfig.rounding as WorklogRoundingMode,
      worklogConfig.min_seconds
    );

    if (roundedSeconds <= 0) {
      throw new Error('OpenSpec session duration must be greater than zero.');
    }

    sessionToSync = {
      ...session,
      ended_at: toUtcIso(ended),
      ended_at_local: toLocalIso(ended),
      paused_duration_seconds: pausedSeconds,
      paused_at: undefined,
      paused_at_local: undefined,
      raw_duration_seconds: rawSeconds,
      rounded_duration_seconds: roundedSeconds,
      comment,
    };
  }

  if (sessionToSync.status !== 'running' && sessionToSync.status !== 'paused' && sessionToSync.status !== 'sync_pending') {
    throw new Error('No active OpenSpec session found.');
  }

  try {
    const response = await syncWorklog(sessionToSync, comment);
    const closedSession: TimerSession = {
      ...sessionToSync,
      jira_worklog_id: typeof response.id === 'string' ? response.id : String(response.id ?? ''),
      worklog_status: 'synced',
      status: 'closed',
      sync_error: undefined,
    };

    await archiveSession(closedSession);
    await clearActiveSession();

    console.log(`Archived OpenSpec session for ${closedSession.jira_issue_key}`);
    console.log(`Duration: ${formatDuration(closedSession.rounded_duration_seconds ?? 0)}`);
    console.log(`Jira worklog created successfully: ${closedSession.jira_worklog_id}`);

    if (options.addJiraArchiveComment !== false) {
      try {
        await addJiraComment(closedSession.jira_issue_key, buildArchiveSuccessComment(closedSession));
        console.log('Jira archive comment created successfully');
      } catch (error) {
        console.log(`Warning: Jira worklog was created, but the archive comment could not be added: ${getErrorMessage(error)}`);
      }
    }

    return closedSession;
  } catch (error) {
    const pendingSession: TimerSession = {
      ...sessionToSync,
      status: 'sync_pending',
      worklog_status: 'pending',
      sync_error: getErrorMessage(error),
      comment,
    };
    await saveActiveSession(pendingSession);
    throw new Error(
      `Failed to create Jira worklog. Session saved as sync_pending. Use 'openspec archive --retry' after fixing the issue.\n${pendingSession.sync_error}`
    );
  }
}

export async function status(): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    console.log('No active OpenSpec session found.');
    return;
  }

  const now = nowUtc();
  const pausedSeconds = getPauseSeconds(session, now);
  const elapsed = session.raw_duration_seconds ?? getElapsedSeconds(session, now);
  console.log(`OpenSpec timer status: ${session.status}`);
  console.log(`Issue: ${session.jira_issue_key}`);
  if (session.jira_ticket?.summary) {
    console.log(`Summary: ${session.jira_ticket.summary}`);
  }
  if (session.openspec_change?.name) {
    console.log(`Change: ${session.openspec_change.name}`);
  }
  console.log(`Started: ${session.started_at_local}`);
  if (session.status === 'paused' && session.paused_at_local) {
    console.log(`Paused: ${session.paused_at_local}`);
  }
  console.log(`Elapsed: ${formatDuration(elapsed)}`);
  if (pausedSeconds > 0) {
    console.log(`Paused time: ${formatDuration(pausedSeconds)}`);
  }
  if (session.sync_error) {
    console.log(`Sync error: ${session.sync_error}`);
  }
}

export async function pause(): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error('No active OpenSpec session found.');
  }
  if (session.status === 'sync_pending') {
    throw new Error("OpenSpec session is pending Jira sync.\nUse 'openspec archive --retry' to retry or 'openspec timer cancel' to discard it.");
  }
  if (session.status === 'paused') {
    throw new Error('OpenSpec session is already paused.');
  }
  if (session.status !== 'running') {
    throw new Error('No running OpenSpec session found.');
  }

  const pausedAt = nowUtc();
  const pauseEvent = {
    paused_at: toUtcIso(pausedAt),
    paused_at_local: toLocalIso(pausedAt),
  };
  const pausedSession: TimerSession = {
    ...session,
    status: 'paused',
    paused_at: pauseEvent.paused_at,
    paused_at_local: pauseEvent.paused_at_local,
    paused_duration_seconds: session.paused_duration_seconds ?? 0,
    pause_events: [...(session.pause_events ?? []), pauseEvent],
  };

  await saveActiveSession(pausedSession);
  console.log(`Paused OpenSpec session for ${session.jira_issue_key} at ${pausedSession.paused_at_local}`);
  console.log(`Elapsed: ${formatDuration(getElapsedSeconds(pausedSession, pausedAt))}`);
}

export async function resume(): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error('No active OpenSpec session found.');
  }
  if (session.status === 'sync_pending') {
    throw new Error("OpenSpec session is pending Jira sync.\nUse 'openspec archive --retry' to retry or 'openspec timer cancel' to discard it.");
  }
  if (session.status === 'running') {
    throw new Error('OpenSpec session is already running.');
  }
  if (session.status !== 'paused' || !session.paused_at) {
    throw new Error('No paused OpenSpec session found.');
  }

  const resumedAt = nowUtc();
  const pauseDuration = secondsBetween(session.paused_at, resumedAt);
  const pauseEvents = [...(session.pause_events ?? [])];
  const lastPause = pauseEvents[pauseEvents.length - 1];
  if (lastPause && !lastPause.resumed_at) {
    pauseEvents[pauseEvents.length - 1] = {
      ...lastPause,
      resumed_at: toUtcIso(resumedAt),
      resumed_at_local: toLocalIso(resumedAt),
      duration_seconds: pauseDuration,
    };
  }

  const resumedSession: TimerSession = {
    ...session,
    status: 'running',
    paused_at: undefined,
    paused_at_local: undefined,
    paused_duration_seconds: (session.paused_duration_seconds ?? 0) + pauseDuration,
    pause_events: pauseEvents,
  };

  await saveActiveSession(resumedSession);
  console.log(`Resumed OpenSpec session for ${session.jira_issue_key} at ${toLocalIso(resumedAt)}`);
  console.log(`Paused time added: ${formatDuration(pauseDuration)}`);
  console.log(`Elapsed: ${formatDuration(getElapsedSeconds(resumedSession, resumedAt))}`);
}

export async function cancel(): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    console.log('No active OpenSpec session found.');
    return;
  }

  await clearActiveSession();
  console.log(`Cancelled OpenSpec session for ${session.jira_issue_key}. No Jira worklog was created.`);
}
