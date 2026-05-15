import { promises as fs } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { getActiveSession, listArchivedSessions } from '../../timer/store.js';
import type { TimerActorMode, TimerBlock, TimerSession, TimerWorkKind } from '../../timer/types.js';
import { RuntimeStore } from '../../../storage/fs/RuntimeStore.js';
import type {
  ApprovalRequest,
  ChangeRuntime,
  ExecutionCycle,
  RuntimeSnapshot,
  SessionRuntime,
  TicketRuntime,
} from '../types.js';
import {
  buildOperationsMonitoringHtml,
  OPERATIONS_MONITORING_APP_JS,
  OPERATIONS_MONITORING_STYLES,
} from './site-template.js';

type MonitoringWindowKey = '7d' | '30d' | 'all';

interface MonitoringWindowDefinition {
  key: MonitoringWindowKey;
  label: string;
  start: Date | null;
}

interface MonitoringBlockRecord {
  ticket_key: string;
  summary: string | null;
  session_id: string;
  developer_id: string;
  change_name: string | null;
  actor_mode: TimerActorMode;
  work_kind: TimerWorkKind;
  description: string;
  source: TimerBlock['source'];
  started_at: string;
  started_at_local: string;
  ended_at: string | null;
  ended_at_local: string | null;
  raw_duration_seconds: number;
  runtime_session_state: SessionRuntime['state'] | null;
  autonomy_level: SessionRuntime['autonomy_level'] | null;
  worklog_status: TimerSession['worklog_status'] | null;
}

interface MonitoringSessionRecord {
  session_id: string;
  ticket_key: string;
  summary: string | null;
  developer_id: string;
  status: TimerSession['status'];
  runtime_session_state: SessionRuntime['state'] | null;
  autonomy_level: SessionRuntime['autonomy_level'] | null;
  command: TimerSession['command'];
  change_name: string | null;
  started_at: string;
  started_at_local: string;
  ended_at: string | null;
  ended_at_local: string | null;
  raw_duration_seconds: number;
  rounded_duration_seconds: number | null;
  paused_duration_seconds: number;
  block_count: number;
  context_switch_count: number;
  actor_mode_seconds: Record<TimerActorMode, number>;
  work_kind_seconds: Record<TimerWorkKind, number>;
  worklog_status: TimerSession['worklog_status'] | null;
  sync_error: string | null;
}

interface MonitoringLiveTicketRecord {
  ticket_key: string;
  summary: string | null;
  ticket_state: TicketRuntime['state'];
  session_state: SessionRuntime['state'];
  activity_mode: SessionRuntime['active_mode'];
  activity_kind: SessionRuntime['active_kind'];
  change_name: string | null;
  change_state: ChangeRuntime['state'] | null;
  autonomy_level: SessionRuntime['autonomy_level'];
  updated_at: string;
}

interface MonitoringActiveSessionRecord {
  session_id: string;
  ticket_key: string;
  summary: string | null;
  developer_id: string;
  session_state: SessionRuntime['state'] | 'ACTIVE' | 'PAUSED' | 'SYNC_PENDING';
  timer_status: TimerSession['status'];
  activity_mode: SessionRuntime['active_mode'] | TimerActorMode | null;
  activity_kind: SessionRuntime['active_kind'] | TimerWorkKind | null;
  change_name: string | null;
  autonomy_level: SessionRuntime['autonomy_level'] | null;
  raw_hours: number;
  started_at: string;
  started_at_local: string;
  sync_error: string | null;
}

interface MonitoringPendingApprovalRecord {
  approval_id: string;
  ticket_key: string;
  change_name: string | null;
  scope: ApprovalRequest['scope'];
  reason: string;
  status: ApprovalRequest['status'];
  created_at: string;
}

interface MonitoringBlockerSummary {
  key: string;
  label: string;
  description: string;
  count: number;
}

interface MonitoringCycleDistributionBucket {
  bucket: string;
  count: number;
}

interface MonitoringCollaborationCell {
  window: MonitoringWindowKey;
  actor_mode: TimerActorMode;
  work_kind: TimerWorkKind;
  raw_hours: number;
}

interface MonitoringDeveloperHours {
  developer_id: string;
  raw_hours: number;
  human_hours: number;
  joint_hours: number;
  ai_hours: number;
}

interface MonitoringWindowMetrics {
  label: string;
  session_count: number;
  closed_session_count: number;
  raw_hours: number;
  jira_billed_hours: number;
  human_hours: number;
  joint_hours: number;
  ai_hours: number;
  planning_hours: number;
  delivery_hours: number;
  maintenance_hours: number;
  pause_ratio: number | null;
  maintenance_reserve_ratio: number | null;
  collaboration_ratio: number | null;
  ai_leverage_ratio: number | null;
  throughput_changes_archived: number;
  archive_block_rate: number | null;
  sync_failure_rate: number | null;
  first_pass_success_rate: number | null;
  approval_resolution_hours_avg: number | null;
  average_block_minutes: number | null;
  average_blocks_per_session: number | null;
  context_switch_rate_per_hour: number | null;
  actor_mode_hours: Record<TimerActorMode, number>;
  work_kind_hours: Record<TimerWorkKind, number>;
  developer_hours: MonitoringDeveloperHours[];
}

export interface OperationsMonitoringSnapshot {
  generated_at: string;
  project_root: string;
  site: {
    label: string;
    title: string;
    subtitle: string;
  };
  live: {
    active_sessions: number;
    paused_sessions: number;
    sync_pending_sessions: number;
    awaiting_human_sessions: number;
    active_tickets: number;
    active_changes: number;
    archive_blocked_changes: number;
    validation_failed_changes: number;
    human_escalation_tickets: number;
    pending_approvals: number;
  };
  windows: Record<MonitoringWindowKey, MonitoringWindowMetrics>;
  blocker_summary: MonitoringBlockerSummary[];
  change_cycle_distribution: MonitoringCycleDistributionBucket[];
  collaboration_matrix: MonitoringCollaborationCell[];
  active_sessions: MonitoringActiveSessionRecord[];
  live_tickets: MonitoringLiveTicketRecord[];
  pending_approvals: MonitoringPendingApprovalRecord[];
  recent_sessions: Array<{
    session_id: string;
    ticket_key: string;
    summary: string | null;
    developer_id: string;
    status: TimerSession['status'];
    change_name: string | null;
    raw_hours: number;
    jira_billed_hours: number | null;
    started_at: string;
    started_at_local: string;
    ended_at: string | null;
    ended_at_local: string | null;
    sync_error: string | null;
  }>;
  entities: {
    sessions: MonitoringSessionRecord[];
    blocks: MonitoringBlockRecord[];
    tickets: TicketRuntime[];
    runtime_sessions: SessionRuntime[];
    changes: ChangeRuntime[];
    cycles: ExecutionCycle[];
    approvals: ApprovalRequest[];
  };
}

export interface OperationsMonitoringExportOptions {
  projectDir?: string;
  outputPath?: string;
  title?: string;
}

export interface OperationsMonitoringBuildSiteOptions {
  projectDir?: string;
  outputDir?: string;
  title?: string;
}

export interface OperationsMonitoringServeOptions {
  projectDir?: string;
  host?: string;
  port?: number;
  title?: string;
}

export interface OperationsMonitoringServerHandle {
  server: Server;
  url: string;
}

interface OperationsMonitoringAssetResponse {
  statusCode: number;
  contentType: string;
  body: string;
}

function zeroActorModeTotals(): Record<TimerActorMode, number> {
  return {
    human: 0,
    human_agent_interaction: 0,
    ai_autonomous: 0,
  };
}

function zeroWorkKindTotals(): Record<TimerWorkKind, number> {
  return {
    implementation: 0,
    spec: 0,
    review: 0,
    bugfix: 0,
    rework: 0,
    testing: 0,
    other: 0,
  };
}

function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

function toRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function sendResponse(
  statusCode: number,
  contentType: string,
  body: string,
  response: ServerResponse<IncomingMessage>,
  method = 'GET'
): void {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });

  if (method.toUpperCase() === 'HEAD') {
    response.end();
    return;
  }

  response.end(body);
}

function secondsBetween(startIso: string, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - new Date(startIso).getTime()) / 1000));
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const map = new Map<string, T>();
  for (const value of values) {
    map.set(key(value), value);
  }
  return [...map.values()];
}

function buildWindowDefinitions(now: Date): MonitoringWindowDefinition[] {
  const dayMs = 24 * 60 * 60 * 1000;
  return [
    { key: '7d', label: 'Last 7 days', start: new Date(now.getTime() - 7 * dayMs) },
    { key: '30d', label: 'Last 30 days', start: new Date(now.getTime() - 30 * dayMs) },
    { key: 'all', label: 'All time', start: null },
  ];
}

function isWithinWindow(iso: string, start: Date | null): boolean {
  if (!start) {
    return true;
  }
  return new Date(iso).getTime() >= start.getTime();
}

function closeCurrentBlockForSnapshot(session: TimerSession, now: Date): TimerBlock[] {
  const blocks = [...(session.blocks ?? [])];
  if (session.status === 'running' && session.current_block) {
    blocks.push({
      ...session.current_block,
      ended_at: now.toISOString(),
      ended_at_local: now.toISOString(),
      raw_duration_seconds: secondsBetween(session.current_block.started_at, now),
    });
  }
  return blocks.filter((block) => (block.raw_duration_seconds ?? 0) > 0);
}

function computeSessionRawDuration(session: TimerSession, blocks: TimerBlock[], now: Date): number {
  if (typeof session.raw_duration_seconds === 'number' && session.raw_duration_seconds > 0) {
    return session.raw_duration_seconds;
  }
  const blockSeconds = blocks.reduce((sum, block) => sum + (block.raw_duration_seconds ?? 0), 0);
  if (blockSeconds > 0) {
    return blockSeconds;
  }
  return secondsBetween(session.started_at, now) - (session.paused_duration_seconds ?? 0);
}

function normalizeStatusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function topLevelBlockerSummary(
  runtimeSessions: SessionRuntime[],
  changes: ChangeRuntime[],
  approvals: ApprovalRequest[],
  currentActiveSession: TimerSession | null
): MonitoringBlockerSummary[] {
  return [
    {
      key: 'sync_pending',
      label: 'Sync pending',
      description: 'Sessions that finished work locally but still need Jira worklog recovery.',
      count: runtimeSessions.filter((session) => session.state === 'SYNC_PENDING').length + (currentActiveSession?.status === 'sync_pending' ? 1 : 0),
    },
    {
      key: 'approval_pending',
      label: 'Approval pending',
      description: 'Human checkpoints still open before execution or archive can continue.',
      count: approvals.filter((approval) => approval.status === 'PENDING').length,
    },
    {
      key: 'archive_blocked',
      label: 'Archive blocked',
      description: 'Changes that cannot close yet because validation or governance stopped them.',
      count: changes.filter((change) => change.state === 'ARCHIVE_BLOCKED').length,
    },
    {
      key: 'validation_failed',
      label: 'Validation failed',
      description: 'Changes currently held in validation-failed runtime states.',
      count: changes.filter((change) => change.validation_status === 'FAILED' || change.state === 'ARCHIVE_BLOCKED').length,
    },
  ].filter((item) => item.count > 0);
}

function bucketCycleCount(count: number): string {
  if (count <= 1) return '1 cycle';
  if (count === 2) return '2 cycles';
  if (count === 3) return '3 cycles';
  return '4+ cycles';
}

function normalizeRuntimeStateFromTimerStatus(status: TimerSession['status']): 'ACTIVE' | 'PAUSED' | 'SYNC_PENDING' | 'CLOSED' {
  switch (status) {
    case 'running':
      return 'ACTIVE';
    case 'paused':
      return 'PAUSED';
    case 'sync_pending':
      return 'SYNC_PENDING';
    case 'closed':
    default:
      return 'CLOSED';
  }
}

export class OperationsMonitoringService {
  constructor(
    private readonly runtimeStore = new RuntimeStore()
  ) {}

  async buildSnapshot(projectDir = process.cwd(), title = 'OpenSpec Operations Monitoring', now = new Date()): Promise<OperationsMonitoringSnapshot> {
    const currentActiveSession = await getActiveSession(projectDir);
    const archivedSessions = await listArchivedSessions(projectDir);
    const timerSessions = uniqueBy(
      [...archivedSessions, ...(currentActiveSession ? [currentActiveSession] : [])],
      (session) => session.session_id
    );

    const ticketKeys = new Set<string>(timerSessions.map((session) => session.jira_issue_key));
    for (const ticketKey of await this.runtimeStore.listTicketKeys(projectDir)) {
      ticketKeys.add(ticketKey);
    }

    const tickets: TicketRuntime[] = [];
    const runtimeSessions: SessionRuntime[] = [];
    const changes: ChangeRuntime[] = [];
    const cycles: ExecutionCycle[] = [];
    const approvals: ApprovalRequest[] = [];

    for (const ticketKey of [...ticketKeys].sort()) {
      const ticket = await this.runtimeStore.getTicketRuntime(ticketKey, projectDir);
      if (ticket) {
        tickets.push(ticket);
      }

      const runtimeSession = await this.runtimeStore.getSessionRuntime(ticketKey, projectDir);
      if (runtimeSession) {
        runtimeSessions.push(runtimeSession);
      }

      const ticketChanges = await this.runtimeStore.listChangeRuntimes(ticketKey, projectDir);
      changes.push(...ticketChanges);

      const ticketApprovals = await this.runtimeStore.listApprovalRequests(ticketKey, projectDir);
      approvals.push(...ticketApprovals);

      for (const change of ticketChanges) {
        const changeCycles = await this.runtimeStore.listExecutionCycles(ticketKey, change.change_name, projectDir);
        cycles.push(...changeCycles);
      }
    }

    const runtimeSessionBySessionId = new Map(runtimeSessions.map((session) => [session.session_id, session] as const));
    const ticketSummaryByKey = new Map(tickets.map((ticket) => [ticket.ticket_key, ticket.summary ?? null] as const));

    const sessionRecords: MonitoringSessionRecord[] = [];
    const blockRecords: MonitoringBlockRecord[] = [];
    const lastObservedBlockBySessionId = new Map<string, TimerBlock | null>();

    for (const session of timerSessions) {
      const runtimeSession = runtimeSessionBySessionId.get(session.session_id) ?? null;
      const blocks = closeCurrentBlockForSnapshot(session, now);
      const lastObservedBlock = session.current_block ?? blocks[blocks.length - 1] ?? null;
      const rawDurationSeconds = Math.max(0, computeSessionRawDuration(session, blocks, now));
      const actorModeSeconds = zeroActorModeTotals();
      const workKindSeconds = zeroWorkKindTotals();
      lastObservedBlockBySessionId.set(session.session_id, lastObservedBlock);

      for (const block of blocks) {
        const rawSeconds = block.raw_duration_seconds ?? 0;
        actorModeSeconds[block.actor_mode] += rawSeconds;
        workKindSeconds[block.work_kind] += rawSeconds;
        blockRecords.push({
          ticket_key: session.jira_issue_key,
          summary: session.jira_ticket?.summary ?? ticketSummaryByKey.get(session.jira_issue_key) ?? null,
          session_id: session.session_id,
          developer_id: session.user_email,
          change_name: session.openspec_change?.name ?? runtimeSession?.change_name ?? null,
          actor_mode: block.actor_mode,
          work_kind: block.work_kind,
          description: block.description,
          source: block.source,
          started_at: block.started_at,
          started_at_local: block.started_at_local,
          ended_at: block.ended_at ?? null,
          ended_at_local: block.ended_at_local ?? null,
          raw_duration_seconds: rawSeconds,
          runtime_session_state: runtimeSession?.state ?? null,
          autonomy_level: runtimeSession?.autonomy_level ?? null,
          worklog_status: session.worklog_status ?? null,
        });
      }

      sessionRecords.push({
        session_id: session.session_id,
        ticket_key: session.jira_issue_key,
        summary: session.jira_ticket?.summary ?? ticketSummaryByKey.get(session.jira_issue_key) ?? null,
        developer_id: session.user_email,
        status: session.status,
        runtime_session_state: runtimeSession?.state ?? null,
        autonomy_level: runtimeSession?.autonomy_level ?? null,
        command: session.command,
        change_name: session.openspec_change?.name ?? runtimeSession?.change_name ?? null,
        started_at: session.started_at,
        started_at_local: session.started_at_local,
        ended_at: session.ended_at ?? null,
        ended_at_local: session.ended_at_local ?? null,
        raw_duration_seconds: rawDurationSeconds,
        rounded_duration_seconds: session.rounded_duration_seconds ?? null,
        paused_duration_seconds: session.paused_duration_seconds ?? 0,
        block_count: blocks.length,
        context_switch_count: Math.max(0, blocks.length - 1),
        actor_mode_seconds: actorModeSeconds,
        work_kind_seconds: workKindSeconds,
        worklog_status: session.worklog_status ?? null,
        sync_error: session.sync_error ?? null,
      });
    }

    const windows = Object.fromEntries(
      buildWindowDefinitions(now).map((windowDef) => {
        const sessionsInWindow = sessionRecords.filter((session) => isWithinWindow(session.started_at, windowDef.start));
        const blocksInWindow = blockRecords.filter((block) => isWithinWindow(block.started_at, windowDef.start));
        const approvalsInWindow = approvals.filter((approval) => isWithinWindow(approval.created_at, windowDef.start));
        const changesInWindow = changes.filter((change) => isWithinWindow(change.updated_at, windowDef.start));

        const actorModeSeconds = zeroActorModeTotals();
        const workKindSeconds = zeroWorkKindTotals();
        let pausedSeconds = 0;

        for (const session of sessionsInWindow) {
          pausedSeconds += session.paused_duration_seconds;
        }

        for (const block of blocksInWindow) {
          actorModeSeconds[block.actor_mode] += block.raw_duration_seconds;
          workKindSeconds[block.work_kind] += block.raw_duration_seconds;
        }

        const rawSeconds = blocksInWindow.reduce((sum, block) => sum + block.raw_duration_seconds, 0);
        const billedSeconds = sessionsInWindow.reduce((sum, session) => sum + (session.rounded_duration_seconds ?? 0), 0);
        const planningSeconds = workKindSeconds.spec;
        const deliverySeconds = workKindSeconds.implementation + workKindSeconds.review + workKindSeconds.testing;
        const maintenanceSeconds = workKindSeconds.bugfix + workKindSeconds.rework;
        const totalChangesForRate = changesInWindow.length;
        const archivedChanges = changesInWindow.filter((change) => change.state === 'ARCHIVED');
        const archiveBlockedChanges = changesInWindow.filter((change) => change.state === 'ARCHIVE_BLOCKED');
        const endedSessions = sessionsInWindow.filter((session) => Boolean(session.ended_at));
        const syncFailures = sessionsInWindow.filter((session) => session.status === 'sync_pending' || session.worklog_status === 'pending');

        const cycleCountByChange = new Map<string, number>();
        for (const cycle of cycles) {
          if (!cycle.change_name || !isWithinWindow(cycle.updated_at, windowDef.start)) {
            continue;
          }
          const key = `${cycle.ticket_key}:${cycle.change_name}`;
          cycleCountByChange.set(key, (cycleCountByChange.get(key) ?? 0) + 1);
        }

        const archivedOrValidatedChanges = changesInWindow.filter((change) => change.state === 'ARCHIVED' || change.state === 'VALIDATED');
        const firstPassChangeCount = archivedOrValidatedChanges.filter((change) => {
          const key = `${change.ticket_key}:${change.change_name}`;
          return (cycleCountByChange.get(key) ?? 0) <= 1;
        }).length;

        const resolvedApprovals = approvalsInWindow.filter((approval) => approval.resolved_at);
        const approvalResolutionSeconds = resolvedApprovals.reduce((sum, approval) => {
          return sum + Math.max(0, secondsBetween(approval.created_at, new Date(approval.resolved_at!)));
        }, 0);

        const developerHours = new Map<string, MonitoringDeveloperHours>();
        for (const session of sessionsInWindow) {
          const existing = developerHours.get(session.developer_id) ?? {
            developer_id: session.developer_id,
            raw_hours: 0,
            human_hours: 0,
            joint_hours: 0,
            ai_hours: 0,
          };
          existing.raw_hours += toHours(session.raw_duration_seconds);
          existing.human_hours += toHours(session.actor_mode_seconds.human);
          existing.joint_hours += toHours(session.actor_mode_seconds.human_agent_interaction);
          existing.ai_hours += toHours(session.actor_mode_seconds.ai_autonomous);
          developerHours.set(session.developer_id, existing);
        }

        const metrics: MonitoringWindowMetrics = {
          label: windowDef.label,
          session_count: sessionsInWindow.length,
          closed_session_count: endedSessions.length,
          raw_hours: toHours(rawSeconds),
          jira_billed_hours: toHours(billedSeconds),
          human_hours: toHours(actorModeSeconds.human),
          joint_hours: toHours(actorModeSeconds.human_agent_interaction),
          ai_hours: toHours(actorModeSeconds.ai_autonomous),
          planning_hours: toHours(planningSeconds),
          delivery_hours: toHours(deliverySeconds),
          maintenance_hours: toHours(maintenanceSeconds),
          pause_ratio: toRatio(pausedSeconds, rawSeconds + pausedSeconds),
          maintenance_reserve_ratio: toRatio(maintenanceSeconds, rawSeconds),
          collaboration_ratio: toRatio(actorModeSeconds.human_agent_interaction, rawSeconds),
          ai_leverage_ratio: toRatio(actorModeSeconds.ai_autonomous, actorModeSeconds.human + actorModeSeconds.human_agent_interaction),
          throughput_changes_archived: archivedChanges.length,
          archive_block_rate: toRatio(archiveBlockedChanges.length, totalChangesForRate),
          sync_failure_rate: toRatio(syncFailures.length, endedSessions.length),
          first_pass_success_rate: toRatio(firstPassChangeCount, archivedOrValidatedChanges.length),
          approval_resolution_hours_avg: resolvedApprovals.length > 0
            ? toHours(approvalResolutionSeconds / resolvedApprovals.length)
            : null,
          average_block_minutes: blocksInWindow.length > 0
            ? Math.round((rawSeconds / blocksInWindow.length / 60) * 10) / 10
            : null,
          average_blocks_per_session: sessionsInWindow.length > 0
            ? Math.round((sessionsInWindow.reduce((sum, session) => sum + session.block_count, 0) / sessionsInWindow.length) * 10) / 10
            : null,
          context_switch_rate_per_hour: rawSeconds > 0
            ? Math.round((sessionsInWindow.reduce((sum, session) => sum + session.context_switch_count, 0) / (rawSeconds / 3600)) * 100) / 100
            : null,
          actor_mode_hours: {
            human: toHours(actorModeSeconds.human),
            human_agent_interaction: toHours(actorModeSeconds.human_agent_interaction),
            ai_autonomous: toHours(actorModeSeconds.ai_autonomous),
          },
          work_kind_hours: {
            implementation: toHours(workKindSeconds.implementation),
            spec: toHours(workKindSeconds.spec),
            review: toHours(workKindSeconds.review),
            bugfix: toHours(workKindSeconds.bugfix),
            rework: toHours(workKindSeconds.rework),
            testing: toHours(workKindSeconds.testing),
            other: toHours(workKindSeconds.other),
          },
          developer_hours: [...developerHours.values()].sort((a, b) => b.raw_hours - a.raw_hours),
        };

        return [windowDef.key, metrics];
      })
    ) as Record<MonitoringWindowKey, MonitoringWindowMetrics>;

    const blockerSummary = topLevelBlockerSummary(runtimeSessions, changes, approvals, currentActiveSession);
    const liveRuntimeSnapshots = await this.loadLiveRuntimeSnapshots(projectDir, tickets, runtimeSessions, changes);
    const activeSessions: MonitoringActiveSessionRecord[] = [...sessionRecords]
      .filter((session) => session.status !== 'closed'
        || (session.runtime_session_state !== null
          && session.runtime_session_state !== 'CLOSED'
          && session.runtime_session_state !== 'CANCELLED'))
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .map((session) => {
        const runtimeSession = runtimeSessionBySessionId.get(session.session_id) ?? null;
        const lastObservedBlock = lastObservedBlockBySessionId.get(session.session_id) ?? null;
        return {
          session_id: session.session_id,
          ticket_key: session.ticket_key,
          summary: session.summary,
          developer_id: session.developer_id,
          session_state: runtimeSession?.state ?? normalizeRuntimeStateFromTimerStatus(session.status),
          timer_status: session.status,
          activity_mode: runtimeSession?.active_mode ?? lastObservedBlock?.actor_mode ?? null,
          activity_kind: runtimeSession?.active_kind ?? lastObservedBlock?.work_kind ?? null,
          change_name: session.change_name,
          autonomy_level: runtimeSession?.autonomy_level ?? session.autonomy_level ?? null,
          raw_hours: toHours(session.raw_duration_seconds),
          started_at: session.started_at,
          started_at_local: session.started_at_local,
          sync_error: session.sync_error,
        };
      });
    const pendingApprovals: MonitoringPendingApprovalRecord[] = approvals
      .filter((approval) => approval.status === 'PENDING')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((approval) => ({
        approval_id: approval.approval_id,
        ticket_key: approval.ticket_key,
        change_name: approval.change_name ?? null,
        scope: approval.scope,
        reason: approval.reason,
        status: approval.status,
        created_at: approval.created_at,
      }));

    const cycleCountByChange = new Map<string, number>();
    for (const cycle of cycles) {
      if (!cycle.change_name) {
        continue;
      }
      const key = `${cycle.ticket_key}:${cycle.change_name}`;
      cycleCountByChange.set(key, (cycleCountByChange.get(key) ?? 0) + 1);
    }
    const changeCycleDistributionMap = new Map<string, number>();
    for (const count of cycleCountByChange.values()) {
      const bucket = bucketCycleCount(count);
      changeCycleDistributionMap.set(bucket, (changeCycleDistributionMap.get(bucket) ?? 0) + 1);
    }

    const collaborationMatrix: MonitoringCollaborationCell[] = [];
    for (const windowDef of buildWindowDefinitions(now)) {
      const blocksInWindow = blockRecords.filter((block) => isWithinWindow(block.started_at, windowDef.start));
      const matrix = new Map<string, number>();
      for (const block of blocksInWindow) {
        const key = `${block.actor_mode}:${block.work_kind}`;
        matrix.set(key, (matrix.get(key) ?? 0) + block.raw_duration_seconds);
      }
      for (const [key, seconds] of matrix.entries()) {
        const [actorMode, workKind] = key.split(':') as [TimerActorMode, TimerWorkKind];
        collaborationMatrix.push({
          window: windowDef.key,
          actor_mode: actorMode,
          work_kind: workKind,
          raw_hours: toHours(seconds),
        });
      }
    }

    return {
      generated_at: now.toISOString(),
      project_root: projectDir,
      site: {
        label: 'Runtime-backed monitoring',
        title,
        subtitle: 'A static operating room for OpenSpec delivery, Jira worklog sync, and human plus AI collaboration.',
      },
      live: {
        active_sessions: runtimeSessions.filter((session) => session.state === 'ACTIVE').length + (currentActiveSession?.status === 'running' && !runtimeSessions.find((session) => session.session_id === currentActiveSession.session_id) ? 1 : 0),
        paused_sessions: runtimeSessions.filter((session) => session.state === 'PAUSED').length,
        sync_pending_sessions: runtimeSessions.filter((session) => session.state === 'SYNC_PENDING').length + (currentActiveSession?.status === 'sync_pending' && !runtimeSessions.find((session) => session.session_id === currentActiveSession.session_id) ? 1 : 0),
        awaiting_human_sessions: runtimeSessions.filter((session) => session.state === 'AWAITING_HUMAN').length,
        active_tickets: liveRuntimeSnapshots.length,
        active_changes: changes.filter((change) => change.state !== 'ARCHIVED').length,
        archive_blocked_changes: changes.filter((change) => change.state === 'ARCHIVE_BLOCKED').length,
        validation_failed_changes: changes.filter((change) => change.validation_status === 'FAILED').length,
        human_escalation_tickets: tickets.filter((ticket) => ticket.state === 'HUMAN_ESCALATION_REQUIRED').length,
        pending_approvals: pendingApprovals.length,
      },
      windows,
      blocker_summary: blockerSummary,
      change_cycle_distribution: [...changeCycleDistributionMap.entries()]
        .map(([bucket, count]) => ({ bucket, count }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket)),
      collaboration_matrix: collaborationMatrix,
      active_sessions: activeSessions,
      live_tickets: liveRuntimeSnapshots,
      pending_approvals: pendingApprovals,
      recent_sessions: [...sessionRecords]
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
        .map((session) => ({
          session_id: session.session_id,
          ticket_key: session.ticket_key,
          summary: session.summary,
          developer_id: session.developer_id,
          status: session.status,
          change_name: session.change_name,
          raw_hours: toHours(session.raw_duration_seconds),
          jira_billed_hours: session.rounded_duration_seconds === null ? null : toHours(session.rounded_duration_seconds),
          started_at: session.started_at,
          started_at_local: session.started_at_local,
          ended_at: session.ended_at,
          ended_at_local: session.ended_at_local,
          sync_error: session.sync_error,
        })),
      entities: {
        sessions: sessionRecords,
        blocks: blockRecords,
        tickets,
        runtime_sessions: runtimeSessions,
        changes,
        cycles,
        approvals,
      },
    };
  }

  async exportData(options: OperationsMonitoringExportOptions = {}): Promise<OperationsMonitoringSnapshot> {
    const projectDir = path.resolve(options.projectDir ?? process.cwd());
    const snapshot = await this.buildSnapshot(projectDir, options.title);

    if (options.outputPath) {
      const outputPath = path.resolve(projectDir, options.outputPath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
      console.log(`Operations monitoring dataset written to ${outputPath}`);
    } else {
      console.log(JSON.stringify(snapshot, null, 2));
    }

    return snapshot;
  }

  async buildStaticSite(options: OperationsMonitoringBuildSiteOptions = {}): Promise<{ outputDir: string; dataPath: string; indexPath: string }> {
    const projectDir = path.resolve(options.projectDir ?? process.cwd());
    const outputDir = path.resolve(projectDir, options.outputDir ?? path.join('.openspec', 'monitoring-site'));
    const title = options.title ?? 'OpenSpec Operations Monitoring';
    const snapshot = await this.buildSnapshot(projectDir, title);

    await fs.mkdir(outputDir, { recursive: true });
    const dataPath = path.join(outputDir, 'monitoring-data.json');
    const indexPath = path.join(outputDir, 'index.html');
    const appPath = path.join(outputDir, 'app.js');
    const stylesPath = path.join(outputDir, 'styles.css');

    await Promise.all([
      fs.writeFile(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8'),
      fs.writeFile(indexPath, `${buildOperationsMonitoringHtml(title)}\n`, 'utf-8'),
      fs.writeFile(appPath, `${OPERATIONS_MONITORING_APP_JS}\n`, 'utf-8'),
      fs.writeFile(stylesPath, `${OPERATIONS_MONITORING_STYLES}\n`, 'utf-8'),
    ]);

    console.log(`Operations monitoring site written to ${outputDir}`);
    console.log(`Open ${indexPath} or serve the directory as a static site.`);

    return { outputDir, dataPath, indexPath };
  }

  async getSiteAsset(
    assetPath: string,
    options: Pick<OperationsMonitoringServeOptions, 'projectDir' | 'title'> = {}
  ): Promise<OperationsMonitoringAssetResponse> {
    const projectDir = path.resolve(options.projectDir ?? process.cwd());
    const title = options.title ?? 'OpenSpec Operations Monitoring';

    if (assetPath === '/' || assetPath === '/index.html') {
      return {
        statusCode: 200,
        contentType: 'text/html; charset=utf-8',
        body: `${buildOperationsMonitoringHtml(title)}\n`,
      };
    }

    if (assetPath === '/app.js') {
      return {
        statusCode: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: `${OPERATIONS_MONITORING_APP_JS}\n`,
      };
    }

    if (assetPath === '/styles.css') {
      return {
        statusCode: 200,
        contentType: 'text/css; charset=utf-8',
        body: `${OPERATIONS_MONITORING_STYLES}\n`,
      };
    }

    if (assetPath === '/monitoring-data.json') {
      const snapshot = await this.buildSnapshot(projectDir, title);
      return {
        statusCode: 200,
        contentType: 'application/json; charset=utf-8',
        body: `${JSON.stringify(snapshot, null, 2)}\n`,
      };
    }

    if (assetPath === '/health') {
      return {
        statusCode: 200,
        contentType: 'application/json; charset=utf-8',
        body: `${JSON.stringify({ ok: true, generated_at: new Date().toISOString() }, null, 2)}\n`,
      };
    }

    return {
      statusCode: 404,
      contentType: 'text/plain; charset=utf-8',
      body: 'Not found\n',
    };
  }

  async serveSite(options: OperationsMonitoringServeOptions = {}): Promise<OperationsMonitoringServerHandle> {
    const projectDir = path.resolve(options.projectDir ?? process.cwd());
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 8001;
    const title = options.title ?? 'OpenSpec Operations Monitoring';

    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
      const pathname = requestUrl.pathname;

      try {
        const asset = await this.getSiteAsset(pathname, { projectDir, title });
        sendResponse(asset.statusCode, asset.contentType, asset.body, response, request.method);
      } catch (error) {
        sendResponse(500, 'text/plain; charset=utf-8', `Monitoring server error: ${(error as Error).message}\n`, response, request.method);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });

    const address = server.address();
    const resolvedPort = typeof address === 'object' && address ? (address as AddressInfo).port : port;
    const url = `http://${host}:${resolvedPort}`;

    return { server, url };
  }

  private async loadLiveRuntimeSnapshots(
    projectDir: string,
    tickets: TicketRuntime[],
    runtimeSessions: SessionRuntime[],
    changes: ChangeRuntime[]
  ): Promise<MonitoringLiveTicketRecord[]> {
    const ticketByKey = new Map(tickets.map((ticket) => [ticket.ticket_key, ticket] as const));
    const changeByTicketAndName = new Map(changes.map((change) => [`${change.ticket_key}:${change.change_name}`, change] as const));

    return runtimeSessions
      .filter((session) => session.state !== 'CLOSED' && session.state !== 'CANCELLED')
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((session) => {
        const ticket = ticketByKey.get(session.ticket_key);
        const change = session.change_name ? changeByTicketAndName.get(`${session.ticket_key}:${session.change_name}`) : undefined;
        return {
          ticket_key: session.ticket_key,
          summary: ticket?.summary ?? null,
          ticket_state: ticket?.state ?? 'DISCOVERED',
          session_state: session.state,
          activity_mode: session.active_mode,
          activity_kind: session.active_kind,
          change_name: session.change_name ?? null,
          change_state: change?.state ?? null,
          autonomy_level: session.autonomy_level,
          updated_at: session.updated_at,
        };
      });
  }
}

export class OperationsMonitoringCommand {
  constructor(
    private readonly service = new OperationsMonitoringService()
  ) {}

  async exportData(options: OperationsMonitoringExportOptions = {}): Promise<void> {
    await this.service.exportData(options);
  }

  async buildStaticSite(options: OperationsMonitoringBuildSiteOptions = {}): Promise<void> {
    await this.service.buildStaticSite(options);
  }

  async serveSite(options: OperationsMonitoringServeOptions = {}): Promise<OperationsMonitoringServerHandle> {
    return this.service.serveSite(options);
  }
}

export function formatMonitoringStatusClass(status: string): string {
  return normalizeStatusClass(status);
}
