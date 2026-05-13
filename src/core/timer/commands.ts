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
import { SessionManager } from '../runtime/session/SessionManager.js';
import { RuntimeStore } from '../../storage/fs/RuntimeStore.js';
import { createChangeFromTicket, fetchImportedJiraTicket } from './ticket-change.js';
import { buildAdfComment, buildWorklogPayload } from './worklog-payload.js';
import type {
  ImportedJiraTicket,
  JiraWorklogSyncResult,
  TimerActorMode,
  TimerBlock,
  TimerBlockSource,
  TimerSession,
  TimerWorkKind,
  WorklogConfig,
} from './types.js';

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;
const DEFAULT_COMMENT = 'OpenSpec execution session';
const DEFAULT_HUMAN_DESCRIPTION = 'Developer implementation work';

const ACTOR_MODE_LABELS: Record<TimerActorMode, string> = {
  human: 'Human work',
  ai_autonomous: 'AI autonomous work',
  human_agent_interaction: 'Human-agent interaction',
};

const WORK_KIND_LABELS: Record<TimerWorkKind, string> = {
  implementation: 'implementation',
  spec: 'spec',
  review: 'review',
  bugfix: 'bugfix',
  rework: 'rework',
  testing: 'testing',
  other: 'other',
};

const ACTOR_MODES = new Set<TimerActorMode>(['human', 'ai_autonomous', 'human_agent_interaction']);
const WORK_KINDS = new Set<TimerWorkKind>(['implementation', 'spec', 'review', 'bugfix', 'rework', 'testing', 'other']);
const sessionManager = new SessionManager();
const runtimeStore = new RuntimeStore();

export interface ArchiveTimerOptions {
  comment?: string;
  retry?: boolean;
  addJiraArchiveComment?: boolean;
}

export interface PurposeOptions {
  importTicket?: boolean;
  createChange?: boolean;
}

export interface StartManualHumanTimerOptions {
  kind?: TimerWorkKind;
  description?: string;
  importTicket?: boolean;
}

export interface SwitchBlockOptions {
  mode: TimerActorMode;
  kind: TimerWorkKind;
  description?: string;
  source?: TimerBlockSource;
}

export interface TimerReportOptions {
  dryRun?: boolean;
  changeName?: string;
  comment?: string;
}

export interface ShowImportedTicketOptions {
  json?: boolean;
}

export interface ImportedTicketView {
  found: boolean;
  reason: 'ok' | 'no_active_session' | 'no_imported_ticket';
  message: string;
  jira_issue_key: string | null;
  ticket: ImportedJiraTicket | null;
}

interface WorklogGroup {
  block_key: string;
  actor_mode: TimerActorMode;
  work_kind: TimerWorkKind;
  description: string;
  started_at: string;
  started_at_local: string;
  raw_duration_seconds: number;
  rounded_duration_seconds: number;
  block_ids: string[];
}

interface TimerReport {
  session: TimerSession;
  groups: WorklogGroup[];
  rawDurationSeconds: number;
  roundedDurationSeconds: number;
}

async function recoverPreviouslyClosedSyncPendingSession(session: TimerSession): Promise<TimerSession | null> {
  const runtimeSession = await runtimeStore.getSessionRuntime(session.jira_issue_key);
  if (!runtimeSession) {
    return null;
  }
  if (runtimeSession.session_id !== session.session_id) {
    return null;
  }
  if (runtimeSession.state !== 'CLOSED' || runtimeSession.worklog_status !== 'synced') {
    return null;
  }

  const recovered: TimerSession = {
    ...session,
    status: 'closed',
    worklog_status: 'synced',
    sync_error: undefined,
    ended_at: session.ended_at ?? runtimeSession.ended_at ?? undefined,
  };
  await archiveSession(recovered);
  await clearActiveSession();

  console.log(`Recovered previously synced OpenSpec session for ${recovered.jira_issue_key}`);
  console.log(`Duration: ${formatDuration(recovered.rounded_duration_seconds ?? 0)}`);
  return recovered;
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

function assertActorMode(value: string): asserts value is TimerActorMode {
  if (!ACTOR_MODES.has(value as TimerActorMode)) {
    throw new Error(`Invalid timer actor mode: ${value}. Expected one of: ${Array.from(ACTOR_MODES).join(', ')}`);
  }
}

function assertWorkKind(value: string): asserts value is TimerWorkKind {
  if (!WORK_KINDS.has(value as TimerWorkKind)) {
    throw new Error(`Invalid timer work kind: ${value}. Expected one of: ${Array.from(WORK_KINDS).join(', ')}`);
  }
}

export function validateTimerActorMode(value: string): TimerActorMode {
  assertActorMode(value);
  return value;
}

export function validateTimerWorkKind(value: string): TimerWorkKind {
  assertWorkKind(value);
  return value;
}

function createBlock(
  started: Date,
  actorMode: TimerActorMode,
  workKind: TimerWorkKind,
  description: string,
  source: TimerBlockSource
): TimerBlock {
  return {
    block_id: randomUUID(),
    actor_mode: actorMode,
    work_kind: workKind,
    description,
    source,
    started_at: toUtcIso(started),
    started_at_local: toLocalIso(started),
  };
}

function closeCurrentBlock(session: TimerSession, ended: Date): TimerSession {
  if (!session.current_block) {
    return session;
  }

  const rawDuration = secondsBetween(session.current_block.started_at, ended);
  const closedBlock: TimerBlock = {
    ...session.current_block,
    ended_at: toUtcIso(ended),
    ended_at_local: toLocalIso(ended),
    raw_duration_seconds: rawDuration,
  };

  return {
    ...session,
    current_block: undefined,
    blocks: rawDuration > 0
      ? [...(session.blocks ?? []), closedBlock]
      : session.blocks ?? [],
  };
}

function startBlock(
  session: TimerSession,
  started: Date,
  actorMode: TimerActorMode,
  workKind: TimerWorkKind,
  description: string,
  source: TimerBlockSource
): TimerSession {
  return {
    ...closeCurrentBlock(session, started),
    current_block: createBlock(started, actorMode, workKind, description, source),
  };
}

function startDefaultHumanBlock(session: TimerSession, started: Date): TimerSession {
  return startBlock(
    session,
    started,
    'human',
    'implementation',
    DEFAULT_HUMAN_DESCRIPTION,
    'auto'
  );
}

function getLastClosedBlock(session: TimerSession): TimerBlock | undefined {
  const blocks = session.blocks ?? [];
  return blocks[blocks.length - 1];
}

function getResumeBlockTemplate(session: TimerSession): Pick<TimerBlock, 'actor_mode' | 'work_kind' | 'description' | 'source'> {
  const previous = getLastClosedBlock(session);
  if (previous) {
    return {
      actor_mode: previous.actor_mode,
      work_kind: previous.work_kind,
      description: previous.description,
      source: previous.source,
    };
  }

  return {
    actor_mode: 'human',
    work_kind: 'implementation',
    description: DEFAULT_HUMAN_DESCRIPTION,
    source: 'auto',
  };
}

function buildBlockKey(block: Pick<TimerBlock, 'actor_mode' | 'work_kind' | 'description'>): string {
  return [
    block.actor_mode,
    block.work_kind,
    block.description.trim().toLowerCase(),
  ].join('|');
}

function buildWorklogComment(
  session: TimerSession,
  group: WorklogGroup,
  archiveComment: string
): string {
  const lines = [
    `OpenSpec: ${ACTOR_MODE_LABELS[group.actor_mode]}`,
    `Kind: ${WORK_KIND_LABELS[group.work_kind]}`,
    `Description: ${group.description}`,
    `Issue: ${session.jira_issue_key}`,
    session.openspec_change?.name ? `Change: ${session.openspec_change.name}` : undefined,
    `Session: ${session.session_id}`,
    archiveComment ? `Archive comment: ${archiveComment}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

function buildWorklogGroups(
  session: TimerSession,
  worklogConfig: Required<WorklogConfig>
): WorklogGroup[] {
  const sourceBlocks = (session.blocks ?? []).filter((block) => (block.raw_duration_seconds ?? 0) > 0);

  if (sourceBlocks.length === 0 && session.raw_duration_seconds !== undefined) {
    const rawSeconds = session.raw_duration_seconds ?? 0;
    return [{
      block_key: 'legacy|human|implementation',
      actor_mode: 'human',
      work_kind: 'implementation',
      description: session.comment ?? worklogConfig.comment_template,
      started_at: session.started_at,
      started_at_local: session.started_at_local,
      raw_duration_seconds: rawSeconds,
      rounded_duration_seconds: roundSeconds(rawSeconds, worklogConfig.rounding, worklogConfig.min_seconds),
      block_ids: [],
    }];
  }

  const groups = new Map<string, WorklogGroup>();
  for (const block of sourceBlocks) {
    const rawSeconds = block.raw_duration_seconds ?? 0;
    const key = buildBlockKey(block);
    const existing = groups.get(key);

    if (existing) {
      existing.raw_duration_seconds += rawSeconds;
      existing.rounded_duration_seconds = roundSeconds(
        existing.raw_duration_seconds,
        worklogConfig.rounding,
        worklogConfig.min_seconds
      );
      existing.block_ids.push(block.block_id);
      continue;
    }

    groups.set(key, {
      block_key: key,
      actor_mode: block.actor_mode,
      work_kind: block.work_kind,
      description: block.description,
      started_at: block.started_at,
      started_at_local: block.started_at_local,
      raw_duration_seconds: rawSeconds,
      rounded_duration_seconds: roundSeconds(rawSeconds, worklogConfig.rounding, worklogConfig.min_seconds),
      block_ids: [block.block_id],
    });
  }

  return [...groups.values()].filter((group) => group.rounded_duration_seconds > 0);
}

function buildReportFromSession(
  session: TimerSession,
  now: Date,
  worklogConfig: Required<WorklogConfig>
): TimerReport {
  const pausedSeconds = getPauseSeconds(session, now);
  const sessionWithClosedBlock = session.status === 'running'
    ? closeCurrentBlock(session, now)
    : session;
  const blockRawSeconds = (sessionWithClosedBlock.blocks ?? []).reduce(
    (sum, block) => sum + (block.raw_duration_seconds ?? 0),
    0
  );
  const rawDurationSeconds = blockRawSeconds > 0
    ? blockRawSeconds
    : Math.max(0, secondsBetween(session.started_at, now) - pausedSeconds);
  const sessionForGroups: TimerSession = {
    ...sessionWithClosedBlock,
    raw_duration_seconds: rawDurationSeconds,
    comment: session.comment,
  };
  const groups = buildWorklogGroups(sessionForGroups, worklogConfig);

  return {
    session: sessionForGroups,
    groups,
    rawDurationSeconds,
    roundedDurationSeconds: groups.reduce((sum, group) => sum + group.rounded_duration_seconds, 0),
  };
}

async function createJiraWorklog(
  session: TimerSession,
  startedAtLocalIso: string,
  durationSeconds: number,
  comment: string
): Promise<Record<string, unknown>> {
  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  const jira = new JiraClient(jiraConfig);
  const payload = buildWorklogPayload(
    startedAtLocalIso,
    durationSeconds,
    comment
  );
  return jira.createWorklog(session.jira_issue_key, payload);
}

class WorklogGroupSyncError extends Error {
  constructor(
    message: string,
    readonly results: JiraWorklogSyncResult[]
  ) {
    super(message);
  }
}

async function syncWorklogGroups(
  session: TimerSession,
  groups: WorklogGroup[],
  archiveComment: string
): Promise<JiraWorklogSyncResult[]> {
  const results = (session.jira_worklogs ?? []).filter((result) => result.status === 'synced');

  for (const group of groups) {
    const alreadySynced = results.find(
      (result) => result.block_key === group.block_key && result.status === 'synced'
    );
    if (alreadySynced) {
      continue;
    }

    try {
      const response = await createJiraWorklog(
        session,
        group.started_at_local,
        group.rounded_duration_seconds,
        buildWorklogComment(session, group, archiveComment)
      );
      results.push({
        block_key: group.block_key,
        actor_mode: group.actor_mode,
        work_kind: group.work_kind,
        description: group.description,
        started_at: group.started_at,
        started_at_local: group.started_at_local,
        raw_duration_seconds: group.raw_duration_seconds,
        rounded_duration_seconds: group.rounded_duration_seconds,
        jira_worklog_id: typeof response.id === 'string' ? response.id : String(response.id ?? ''),
        status: 'synced',
      });
    } catch (error) {
      results.push({
        block_key: group.block_key,
        actor_mode: group.actor_mode,
        work_kind: group.work_kind,
        description: group.description,
        started_at: group.started_at,
        started_at_local: group.started_at_local,
        raw_duration_seconds: group.raw_duration_seconds,
        rounded_duration_seconds: group.rounded_duration_seconds,
        status: 'pending',
        sync_error: getErrorMessage(error),
      });
      throw new WorklogGroupSyncError(getErrorMessage(error), results);
    }
  }

  return results;
}

async function addJiraComment(issueKey: string, text: string): Promise<Record<string, unknown>> {
  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  const jira = new JiraClient(jiraConfig);
  return jira.addComment(issueKey, { body: buildAdfComment(text) });
}

function buildArchiveSuccessComment(session: TimerSession): string {
  const worklogIds = (session.jira_worklogs ?? [])
    .map((worklog) => worklog.jira_worklog_id)
    .filter((id): id is string => Boolean(id));
  const breakdown = (session.jira_worklogs ?? [])
    .filter((worklog) => worklog.status === 'synced')
    .map((worklog) => `- ${ACTOR_MODE_LABELS[worklog.actor_mode]} / ${worklog.work_kind}: ${formatDuration(worklog.rounded_duration_seconds)}`);
  const lines = [
    'OpenSpec archive completed.',
    '',
    `Issue: ${session.jira_issue_key}`,
    session.openspec_change?.name ? `Change: ${session.openspec_change.name}` : undefined,
    `Duration: ${formatDuration(session.rounded_duration_seconds ?? 0)}`,
    worklogIds.length > 0 ? `Jira worklogs: ${worklogIds.join(', ')}` : session.jira_worklog_id ? `Jira worklog: ${session.jira_worklog_id}` : undefined,
    session.comment ? `Comment: ${session.comment}` : undefined,
    breakdown.length > 0 ? `\nBreakdown:\n${breakdown.join('\n')}` : undefined,
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
  const started = nowUtc();

  const existing = await getActiveSession();
  if (existing?.status === 'running' || existing?.status === 'paused') {
    throw new Error("There is already an active OpenSpec session.\nUse 'osj archive' or 'osj timer cancel'.");
  }
  if (existing?.status === 'sync_pending') {
    throw new Error("There is a pending OpenSpec worklog sync.\nUse 'osj archive --retry' or 'osj timer cancel'.");
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

  let session: TimerSession = {
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
    blocks: [],
    current_block: createBlock(
      started,
      options.importTicket || options.createChange ? 'ai_autonomous' : 'human',
      options.importTicket || options.createChange ? 'spec' : 'implementation',
      options.createChange
        ? 'OpenSpec generated change artifacts from Jira ticket'
        : options.importTicket
          ? 'OpenSpec imported Jira ticket context'
          : DEFAULT_HUMAN_DESCRIPTION,
      'auto'
    ),
  };

  if (options.importTicket || options.createChange) {
    const handoffAt = nowUtc();
    session = startDefaultHumanBlock(session, handoffAt);
  }

  await saveActiveSession(session);
  await sessionManager.syncFromTimerSession(session);
  console.log(`Started OpenSpec session for ${issueKey} at ${session.started_at_local}`);
  if (importedTicket) {
    console.log(`Imported Jira ticket context: ${importedTicket.key} - ${importedTicket.summary}`);
  }
  if (createdChange) {
    console.log(`Created OpenSpec change '${createdChange.name}' at openspec/changes/${createdChange.name}/`);
  }
}

export async function startManualHumanTimer(
  issueKey: string,
  options: StartManualHumanTimerOptions = {}
): Promise<void> {
  validateIssueKey(issueKey);

  const existing = await getActiveSession();
  if (existing?.status === 'running' || existing?.status === 'paused') {
    throw new Error("There is already an active OpenSpec session.\nUse 'osj archive' or 'osj timer cancel'.");
  }
  if (existing?.status === 'sync_pending') {
    throw new Error("There is a pending OpenSpec worklog sync.\nUse 'osj archive --retry' or 'osj timer cancel'.");
  }

  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  let importedTicket: ImportedJiraTicket | undefined;

  if (options.importTicket) {
    importedTicket = await fetchImportedJiraTicket(issueKey);
  } else {
    const jira = new JiraClient(jiraConfig);
    await jira.getIssue(issueKey);
  }

  const started = nowUtc();
  const kind = options.kind ?? 'implementation';
  const description = options.description?.trim()
    || (kind === 'bugfix' ? 'Manual bugfix work' : DEFAULT_HUMAN_DESCRIPTION);
  const session: TimerSession = {
    session_id: randomUUID(),
    jira_issue_key: issueKey,
    jira_ticket: importedTicket,
    started_at: toUtcIso(started),
    started_at_local: toLocalIso(started),
    user_email: jiraConfig.email,
    status: 'running',
    command: 'timer_start',
    cwd: process.cwd(),
    notes: null,
    paused_duration_seconds: 0,
    pause_events: [],
    blocks: [],
    current_block: createBlock(
      started,
      'human',
      kind,
      description,
      'manual'
    ),
  };

  await saveActiveSession(session);
  await sessionManager.syncFromTimerSession(session);
  console.log(`Started manual human OpenSpec timer for ${issueKey} at ${session.started_at_local}`);
  console.log(`Current block: human / ${kind}`);
  if (importedTicket) {
    console.log(`Imported Jira ticket context: ${importedTicket.key} - ${importedTicket.summary}`);
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

  if (session.status === 'sync_pending') {
    const recoveredSession = await recoverPreviouslyClosedSyncPendingSession(session);
    if (recoveredSession) {
      return recoveredSession;
    }
  }

  let sessionToSync = session;
  if (session.status === 'running' || session.status === 'paused') {
    const ended = nowUtc();
    const pausedSeconds = getPauseSeconds(session, ended);
    const sessionWithClosedBlock = session.status === 'running'
      ? closeCurrentBlock(session, ended)
      : session;
    const blockRawSeconds = (sessionWithClosedBlock.blocks ?? []).reduce(
      (sum, block) => sum + (block.raw_duration_seconds ?? 0),
      0
    );
    const rawSeconds = blockRawSeconds > 0
      ? blockRawSeconds
      : Math.max(0, secondsBetween(session.started_at, ended) - pausedSeconds);

    if (rawSeconds < 0) {
      throw new Error('OpenSpec session duration must be greater than zero.');
    }

    sessionToSync = {
      ...sessionWithClosedBlock,
      ended_at: toUtcIso(ended),
      ended_at_local: toLocalIso(ended),
      paused_duration_seconds: pausedSeconds,
      paused_at: undefined,
      paused_at_local: undefined,
      raw_duration_seconds: rawSeconds,
      comment,
    };

    const groups = buildWorklogGroups(sessionToSync, worklogConfig);
    sessionToSync = {
      ...sessionToSync,
      rounded_duration_seconds: groups.reduce((sum, group) => sum + group.rounded_duration_seconds, 0),
    };
  }

  if (sessionToSync.status !== 'running' && sessionToSync.status !== 'paused' && sessionToSync.status !== 'sync_pending') {
    throw new Error('No active OpenSpec session found.');
  }

  const groups = buildWorklogGroups(sessionToSync, worklogConfig);
  const roundedTotal = groups.reduce((sum, group) => sum + group.rounded_duration_seconds, 0);
  if (groups.length === 0 || roundedTotal <= 0) {
    throw new Error('OpenSpec session duration must be greater than zero.');
  }

  try {
    const jiraWorklogs = await syncWorklogGroups(sessionToSync, groups, comment);
    const worklogIds = jiraWorklogs
      .map((worklog) => worklog.jira_worklog_id)
      .filter((id): id is string => Boolean(id));
    const closedSession: TimerSession = {
      ...sessionToSync,
      jira_worklog_id: worklogIds[0] ?? '',
      jira_worklogs: jiraWorklogs,
      worklog_status: 'synced',
      status: 'closed',
      sync_error: undefined,
    };

    await sessionManager.syncFromTimerSession(closedSession);
    await archiveSession(closedSession);
    await clearActiveSession();

    console.log(`Archived OpenSpec session for ${closedSession.jira_issue_key}`);
    console.log(`Duration: ${formatDuration(closedSession.rounded_duration_seconds ?? 0)}`);
    if (worklogIds.length === 1) {
      console.log(`Jira worklog created successfully: ${worklogIds[0]}`);
    } else {
      console.log(`Jira worklogs created successfully: ${worklogIds.join(', ')}`);
    }

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
    const partialResults = error instanceof WorklogGroupSyncError ? error.results : sessionToSync.jira_worklogs;
    const pendingSession: TimerSession = {
      ...sessionToSync,
      status: 'sync_pending',
      worklog_status: 'pending',
      jira_worklogs: partialResults,
      sync_error: error instanceof WorklogGroupSyncError ? error.message : getErrorMessage(error),
      comment,
    };
    await saveActiveSession(pendingSession);
    try {
      await sessionManager.syncFromTimerSession(pendingSession);
    } catch (runtimeSyncError) {
      const recoveredSession = await recoverPreviouslyClosedSyncPendingSession(pendingSession);
      if (recoveredSession) {
        return recoveredSession;
      }
      throw new Error(
        `Failed to create Jira worklog. Session saved as sync_pending, but runtime state could not be updated.\n${pendingSession.sync_error}\nRuntime sync error: ${getErrorMessage(runtimeSyncError)}`
      );
    }
    throw new Error(
      `Failed to create Jira worklog. Session saved as sync_pending. Use 'osj archive --retry' after fixing the issue.\n${pendingSession.sync_error}`
    );
  }
}

export async function status(options: { blocks?: boolean } = {}): Promise<void> {
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
  if (session.current_block) {
    const currentElapsed = session.status === 'paused'
      ? 0
      : secondsBetween(session.current_block.started_at, now);
    console.log(`Current block: ${session.current_block.actor_mode} / ${session.current_block.work_kind}`);
    console.log(`Current block elapsed: ${formatDuration(currentElapsed)}`);
  }
  if (options.blocks) {
    const blocks = session.blocks ?? [];
    if (blocks.length === 0) {
      console.log('Blocks: none closed yet');
    } else {
      console.log('Blocks:');
      for (const block of blocks) {
        console.log(`- ${formatDuration(block.raw_duration_seconds ?? 0)} ${block.actor_mode} / ${block.work_kind}: ${block.description}`);
      }
    }
  }
  if (session.sync_error) {
    console.log(`Sync error: ${session.sync_error}`);
  }
}

export async function showImportedTicket(options: ShowImportedTicketOptions = {}): Promise<void> {
  const session = await getActiveSession();
  const result: ImportedTicketView = !session
    ? {
        found: false,
        reason: 'no_active_session',
        message: 'No active OpenSpec session found.',
        jira_issue_key: null,
        ticket: null,
      }
    : !session.jira_ticket
      ? {
          found: false,
          reason: 'no_imported_ticket',
          message: `Active session for ${session.jira_issue_key} has no imported Jira ticket context.`,
          jira_issue_key: session.jira_issue_key,
          ticket: null,
        }
      : {
          found: true,
          reason: 'ok',
          message: `Imported Jira ticket context is available for ${session.jira_ticket.key}.`,
          jira_issue_key: session.jira_issue_key,
          ticket: session.jira_ticket,
        };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.found) {
    console.log(result.message);
    if (result.reason === 'no_imported_ticket') {
      console.log("Start the session with `osj purpose --jira PROJ-123 --import-ticket` to persist ticket content locally.");
    }
    return;
  }

  const ticket = result.ticket!;
  console.log(`Ticket: ${ticket.key}`);
  console.log(`Summary: ${ticket.summary}`);
  console.log(`Status: ${ticket.status ?? 'Unknown'}`);
  console.log(`Assignee: ${ticket.assignee ?? 'Unassigned'}`);
  console.log(`URL: ${ticket.url}`);
  console.log('Description:');
  console.log(ticket.description_text || 'No Jira description provided.');
}

export async function report(options: TimerReportOptions = {}): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    console.log('No active OpenSpec session found.');
    return;
  }

  const config = getTimerConfig();
  const worklogConfig = resolveWorklogConfig(config.worklog);
  const reportSession = options.comment ? { ...session, comment: options.comment } : session;
  const preview = buildReportFromSession(reportSession, nowUtc(), worklogConfig);

  if (options.dryRun) {
    console.log('OpenSpec archive dry run');
    console.log('No OpenSpec files will be changed.');
    console.log('No Jira worklogs or comments will be created.');
    if (options.changeName) {
      console.log(`Change: ${options.changeName}`);
    }
    console.log('');
  }

  console.log(`Issue: ${preview.session.jira_issue_key}`);
  if (preview.session.jira_ticket?.summary) {
    console.log(`Summary: ${preview.session.jira_ticket.summary}`);
  }
  if (preview.session.openspec_change?.name) {
    console.log(`Session change: ${preview.session.openspec_change.name}`);
  }
  console.log(`Session status: ${session.status}`);
  console.log(`Raw duration: ${formatDuration(preview.rawDurationSeconds)}`);
  console.log(`Rounded Jira duration: ${formatDuration(preview.roundedDurationSeconds)}`);

  if (preview.groups.length === 0) {
    console.log('Jira worklogs to create: none');
    return;
  }

  console.log('Jira worklogs to create:');
  preview.groups.forEach((group, index) => {
    console.log(`${index + 1}. ${ACTOR_MODE_LABELS[group.actor_mode]} / ${group.work_kind}`);
    console.log(`   Duration: ${formatDuration(group.rounded_duration_seconds)} (raw ${formatDuration(group.raw_duration_seconds)})`);
    console.log(`   Description: ${group.description}`);
    console.log(`   Started: ${group.started_at_local}`);
  });
}

export async function switchBlock(options: SwitchBlockOptions): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error('No active OpenSpec session found.');
  }
  if (session.status === 'sync_pending') {
    throw new Error("OpenSpec session is pending Jira sync.\nUse 'osj archive --retry' to retry or 'osj timer cancel' to discard it.");
  }
  if (session.status === 'paused') {
    throw new Error("OpenSpec session is paused.\nUse 'openspec timer resume' before switching work blocks.");
  }
  if (session.status !== 'running') {
    throw new Error('No running OpenSpec session found.');
  }

  const switchedSession = await switchRunningSessionBlock(options);
  if (!switchedSession) {
    throw new Error('No running OpenSpec session found.');
  }
  console.log(`Switched OpenSpec timer block for ${session.jira_issue_key}`);
  console.log(`Current block: ${options.mode} / ${options.kind}`);
}

export async function switchRunningSessionBlock(options: SwitchBlockOptions): Promise<TimerSession | null> {
  const session = await getActiveSession();
  if (!session || session.status !== 'running') {
    return null;
  }

  const switchedAt = nowUtc();
  const switchedSession = startBlock(
    session,
    switchedAt,
    options.mode,
    options.kind,
    options.description?.trim() || `${ACTOR_MODE_LABELS[options.mode]} / ${options.kind}`,
    options.source ?? 'manual'
  );

  await saveActiveSession(switchedSession);
  await sessionManager.syncFromTimerSession(switchedSession);
  return switchedSession;
}

export async function switchToAutomaticBlock(
  mode: TimerActorMode,
  kind: TimerWorkKind,
  description: string
): Promise<boolean> {
  return Boolean(await switchRunningSessionBlock({
    mode,
    kind,
    description,
    source: 'auto',
  }));
}

export async function switchToDefaultHumanWork(description = DEFAULT_HUMAN_DESCRIPTION): Promise<boolean> {
  return Boolean(await switchRunningSessionBlock({
    mode: 'human',
    kind: 'implementation',
    description,
    source: 'auto',
  }));
}

export async function pause(): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error('No active OpenSpec session found.');
  }
  if (session.status === 'sync_pending') {
    throw new Error("OpenSpec session is pending Jira sync.\nUse 'osj archive --retry' to retry or 'osj timer cancel' to discard it.");
  }
  if (session.status === 'paused') {
    throw new Error('OpenSpec session is already paused.');
  }
  if (session.status !== 'running') {
    throw new Error('No running OpenSpec session found.');
  }

  const pausedAt = nowUtc();
  const sessionWithClosedBlock = closeCurrentBlock(session, pausedAt);
  const pauseEvent = {
    paused_at: toUtcIso(pausedAt),
    paused_at_local: toLocalIso(pausedAt),
  };
  const pausedSession: TimerSession = {
    ...sessionWithClosedBlock,
    status: 'paused',
    paused_at: pauseEvent.paused_at,
    paused_at_local: pauseEvent.paused_at_local,
    paused_duration_seconds: session.paused_duration_seconds ?? 0,
    pause_events: [...(session.pause_events ?? []), pauseEvent],
  };

  await saveActiveSession(pausedSession);
  await sessionManager.syncFromTimerSession(pausedSession);
  console.log(`Paused OpenSpec session for ${session.jira_issue_key} at ${pausedSession.paused_at_local}`);
  console.log(`Elapsed: ${formatDuration(getElapsedSeconds(pausedSession, pausedAt))}`);
}

export async function resume(): Promise<void> {
  const session = await getActiveSession();
  if (!session) {
    throw new Error('No active OpenSpec session found.');
  }
  if (session.status === 'sync_pending') {
    throw new Error("OpenSpec session is pending Jira sync.\nUse 'osj archive --retry' to retry or 'osj timer cancel' to discard it.");
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

  let resumedSession: TimerSession = {
    ...session,
    status: 'running',
    paused_at: undefined,
    paused_at_local: undefined,
    paused_duration_seconds: (session.paused_duration_seconds ?? 0) + pauseDuration,
    pause_events: pauseEvents,
  };
  const resumeTemplate = getResumeBlockTemplate(resumedSession);
  resumedSession = startBlock(
    resumedSession,
    resumedAt,
    resumeTemplate.actor_mode,
    resumeTemplate.work_kind,
    resumeTemplate.description,
    resumeTemplate.source
  );

  await saveActiveSession(resumedSession);
  await sessionManager.syncFromTimerSession(resumedSession);
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

  await sessionManager.markCancelled(session);
  await clearActiveSession();
  console.log(`Cancelled OpenSpec session for ${session.jira_issue_key}. No Jira worklog was created.`);
}
