import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { TimerSession } from '../../../src/core/timer/types.js';
import { archiveSession, saveActiveSession } from '../../../src/core/timer/store.js';
import { RuntimeStore } from '../../../src/storage/fs/RuntimeStore.js';
import { OperationsMonitoringService } from '../../../src/core/runtime/monitoring/OperationsMonitoringCommand.js';

function createSession(input: Partial<TimerSession> & Pick<TimerSession, 'session_id' | 'jira_issue_key' | 'started_at' | 'started_at_local' | 'user_email' | 'status' | 'command' | 'cwd'>): TimerSession {
  return {
    notes: null,
    paused_duration_seconds: 0,
    pause_events: [],
    blocks: [],
    ...input,
  };
}

describe('OperationsMonitoringService', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ops-monitoring-')));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('builds a monitoring snapshot with windowed metrics and blocker summaries', async () => {
    const runtimeStore = new RuntimeStore();
    const service = new OperationsMonitoringService(runtimeStore);
    const now = new Date('2026-05-13T15:00:00.000Z');

    await archiveSession(createSession({
      session_id: 'sess-1',
      jira_issue_key: 'PROJ-1',
      jira_ticket: {
        key: 'PROJ-1',
        summary: 'Ship monitoring dashboard',
        status: 'In Progress',
        assignee: 'Dev One',
        description_text: 'Monitoring work',
        url: 'https://example.test/browse/PROJ-1',
      },
      openspec_change: {
        name: 'proj-1-monitoring',
        path: path.join(tempDir, 'openspec', 'changes', 'proj-1-monitoring'),
        schema: 'spec-driven',
      },
      started_at: '2026-05-11T10:00:00.000Z',
      started_at_local: '2026-05-11T07:00:00-03:00',
      ended_at: '2026-05-11T12:00:00.000Z',
      ended_at_local: '2026-05-11T09:00:00-03:00',
      user_email: 'dev1@example.com',
      status: 'closed',
      command: 'purpose',
      cwd: tempDir,
      raw_duration_seconds: 7200,
      rounded_duration_seconds: 7200,
      worklog_status: 'synced',
      blocks: [
        {
          block_id: 'block-1',
          actor_mode: 'human',
          work_kind: 'implementation',
          description: 'Build export command',
          source: 'manual',
          started_at: '2026-05-11T10:00:00.000Z',
          started_at_local: '2026-05-11T07:00:00-03:00',
          ended_at: '2026-05-11T11:00:00.000Z',
          ended_at_local: '2026-05-11T08:00:00-03:00',
          raw_duration_seconds: 3600,
        },
        {
          block_id: 'block-2',
          actor_mode: 'human_agent_interaction',
          work_kind: 'spec',
          description: 'Refine dashboard scope',
          source: 'auto',
          started_at: '2026-05-11T11:00:00.000Z',
          started_at_local: '2026-05-11T08:00:00-03:00',
          ended_at: '2026-05-11T11:30:00.000Z',
          ended_at_local: '2026-05-11T08:30:00-03:00',
          raw_duration_seconds: 1800,
        },
        {
          block_id: 'block-3',
          actor_mode: 'ai_autonomous',
          work_kind: 'spec',
          description: 'Generate artifacts',
          source: 'auto',
          started_at: '2026-05-11T11:30:00.000Z',
          started_at_local: '2026-05-11T08:30:00-03:00',
          ended_at: '2026-05-11T12:00:00.000Z',
          ended_at_local: '2026-05-11T09:00:00-03:00',
          raw_duration_seconds: 1800,
        },
      ],
    }), tempDir);

    await archiveSession(createSession({
      session_id: 'sess-2',
      jira_issue_key: 'PROJ-2',
      jira_ticket: {
        key: 'PROJ-2',
        summary: 'Recover pending sync',
        status: 'Blocked',
        assignee: 'Dev Two',
        description_text: 'Recovery work',
        url: 'https://example.test/browse/PROJ-2',
      },
      openspec_change: {
        name: 'proj-2-recovery',
        path: path.join(tempDir, 'openspec', 'changes', 'proj-2-recovery'),
        schema: 'spec-driven',
      },
      started_at: '2026-05-12T13:00:00.000Z',
      started_at_local: '2026-05-12T10:00:00-03:00',
      ended_at: '2026-05-12T14:00:00.000Z',
      ended_at_local: '2026-05-12T11:00:00-03:00',
      user_email: 'dev2@example.com',
      status: 'sync_pending',
      command: 'purpose',
      cwd: tempDir,
      raw_duration_seconds: 3600,
      rounded_duration_seconds: 3600,
      worklog_status: 'pending',
      sync_error: 'fetch failed',
      blocks: [
        {
          block_id: 'block-4',
          actor_mode: 'human',
          work_kind: 'bugfix',
          description: 'Retry worklog sync',
          source: 'manual',
          started_at: '2026-05-12T13:00:00.000Z',
          started_at_local: '2026-05-12T10:00:00-03:00',
          ended_at: '2026-05-12T14:00:00.000Z',
          ended_at_local: '2026-05-12T11:00:00-03:00',
          raw_duration_seconds: 3600,
        },
      ],
    }), tempDir);

    await runtimeStore.saveTicketRuntime({
      runtime_version: 1,
      created_at: '2026-05-11T12:00:00.000Z',
      updated_at: '2026-05-11T12:10:00.000Z',
      ticket_key: 'PROJ-1',
      state: 'ARCHIVED',
      summary: 'Ship monitoring dashboard',
      active_session_id: 'sess-1',
      active_change_name: 'proj-1-monitoring',
    }, tempDir);

    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T12:10:00.000Z',
      session_id: 'sess-1',
      ticket_key: 'PROJ-1',
      developer_id: 'dev1@example.com',
      started_at: '2026-05-11T10:00:00.000Z',
      ended_at: '2026-05-11T12:00:00.000Z',
      state: 'CLOSED',
      command: 'purpose',
      cwd: tempDir,
      change_name: 'proj-1-monitoring',
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'implementation',
      current_cycle: 1,
      last_timer_status: 'closed',
      worklog_status: 'synced',
    }, tempDir);

    await runtimeStore.saveChangeRuntime({
      runtime_version: 1,
      created_at: '2026-05-11T10:10:00.000Z',
      updated_at: '2026-05-11T12:10:00.000Z',
      change_name: 'proj-1-monitoring',
      ticket_key: 'PROJ-1',
      state: 'ARCHIVED',
      validation_status: 'PASSED',
      archive_eligible: true,
      worklog_eligible: true,
    }, tempDir);

    await runtimeStore.saveExecutionCycle({
      runtime_version: 1,
      created_at: '2026-05-11T10:20:00.000Z',
      updated_at: '2026-05-11T12:00:00.000Z',
      cycle_id: 'cycle-001',
      session_id: 'sess-1',
      ticket_key: 'PROJ-1',
      change_name: 'proj-1-monitoring',
      iteration_no: 1,
      started_at: '2026-05-11T10:20:00.000Z',
      ended_at: '2026-05-11T12:00:00.000Z',
      state: 'PASSED',
      initiated_by: 'agent',
    }, tempDir);

    await runtimeStore.saveTicketRuntime({
      runtime_version: 1,
      created_at: '2026-05-12T14:00:00.000Z',
      updated_at: '2026-05-12T14:05:00.000Z',
      ticket_key: 'PROJ-2',
      state: 'HUMAN_ESCALATION_REQUIRED',
      summary: 'Recover pending sync',
      active_session_id: 'sess-2',
      active_change_name: 'proj-2-recovery',
    }, tempDir);

    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: '2026-05-12T13:00:00.000Z',
      updated_at: '2026-05-12T14:05:00.000Z',
      session_id: 'sess-2',
      ticket_key: 'PROJ-2',
      developer_id: 'dev2@example.com',
      started_at: '2026-05-12T13:00:00.000Z',
      ended_at: '2026-05-12T14:00:00.000Z',
      state: 'SYNC_PENDING',
      command: 'purpose',
      cwd: tempDir,
      change_name: 'proj-2-recovery',
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'bugfix',
      current_cycle: 2,
      last_timer_status: 'sync_pending',
      worklog_status: 'pending',
      sync_error: 'fetch failed',
    }, tempDir);

    await runtimeStore.saveChangeRuntime({
      runtime_version: 1,
      created_at: '2026-05-12T13:10:00.000Z',
      updated_at: '2026-05-12T14:05:00.000Z',
      change_name: 'proj-2-recovery',
      ticket_key: 'PROJ-2',
      state: 'ARCHIVE_BLOCKED',
      validation_status: 'FAILED',
      archive_eligible: false,
      worklog_eligible: true,
    }, tempDir);

    await runtimeStore.saveApprovalRequest({
      runtime_version: 1,
      created_at: '2026-05-12T14:05:00.000Z',
      updated_at: '2026-05-12T14:05:00.000Z',
      approval_id: 'approval-1',
      ticket_key: 'PROJ-2',
      session_id: 'sess-2',
      change_name: 'proj-2-recovery',
      scope: 'archive',
      reason: 'Human recovery approval required.',
      evidence_refs: ['.openspec/runtime/tickets/PROJ-2/approvals/approval-1.json'],
      status: 'PENDING',
    }, tempDir);

    const snapshot = await service.buildSnapshot(tempDir, 'Ops Site', now);

    expect(snapshot.site.title).toBe('Ops Site');
    expect(snapshot.live.sync_pending_sessions).toBe(1);
    expect(snapshot.live.archive_blocked_changes).toBe(1);
    expect(snapshot.live.pending_approvals).toBe(1);
    expect(snapshot.windows.all.raw_hours).toBe(3);
    expect(snapshot.windows.all.human_hours).toBe(2);
    expect(snapshot.windows.all.joint_hours).toBe(0.5);
    expect(snapshot.windows.all.ai_hours).toBe(0.5);
    expect(snapshot.windows.all.planning_hours).toBe(1);
    expect(snapshot.windows.all.delivery_hours).toBe(1);
    expect(snapshot.windows.all.maintenance_hours).toBe(1);
    expect(snapshot.windows.all.throughput_changes_archived).toBe(1);
    expect(snapshot.windows.all.first_pass_success_rate).toBe(1);
    expect(snapshot.windows.all.sync_failure_rate).toBe(0.5);
    expect(snapshot.blocker_summary.some((item) => item.key === 'sync_pending')).toBe(true);
    expect(snapshot.active_sessions).toHaveLength(1);
    expect(snapshot.active_sessions[0]?.ticket_key).toBe('PROJ-2');
    expect(snapshot.active_sessions[0]?.session_state).toBe('SYNC_PENDING');
    expect(snapshot.live_tickets[0]?.ticket_key).toBe('PROJ-2');
  });

  it('builds a static site bundle with embedded monitoring data', async () => {
    const service = new OperationsMonitoringService(new RuntimeStore());
    const outputDir = path.join(tempDir, 'monitoring-site');

    await service.buildStaticSite({
      projectDir: tempDir,
      outputDir,
      title: 'Static Monitoring',
    });

    const files = await fs.readdir(outputDir);
    expect(files).toContain('index.html');
    expect(files).toContain('app.js');
    expect(files).toContain('styles.css');
    expect(files).toContain('monitoring-data.json');

    const html = await fs.readFile(path.join(outputDir, 'index.html'), 'utf-8');
    expect(html).toContain('Static Monitoring');
  });

  it('renders live monitoring data that reflects the current active session on refresh', async () => {
    const runtimeStore = new RuntimeStore();
    const service = new OperationsMonitoringService(runtimeStore);
    const firstAsset = await service.getSiteAsset('/monitoring-data.json', {
      projectDir: tempDir,
      title: 'Live Monitoring',
    });
    expect(firstAsset.statusCode).toBe(200);
    const firstSnapshot = JSON.parse(firstAsset.body) as { live: { active_sessions: number } };
    expect(firstSnapshot.live.active_sessions).toBe(0);

    await saveActiveSession(createSession({
      session_id: 'sess-live',
      jira_issue_key: 'PROJ-LIVE',
      jira_ticket: {
        key: 'PROJ-LIVE',
        summary: 'Observe live runtime',
        status: 'In Progress',
        assignee: 'Live Dev',
        description_text: 'Live session',
        url: 'https://example.test/browse/PROJ-LIVE',
      },
      started_at: '2026-05-13T15:00:00.000Z',
      started_at_local: '2026-05-13T12:00:00-03:00',
      user_email: 'live@example.com',
      status: 'running',
      command: 'purpose',
      cwd: tempDir,
      raw_duration_seconds: 0,
      blocks: [
        {
          block_id: 'live-block-1',
          actor_mode: 'human',
          work_kind: 'implementation',
          description: 'Inspect active session',
          source: 'manual',
          started_at: '2026-05-13T15:00:00.000Z',
          started_at_local: '2026-05-13T12:00:00-03:00',
          raw_duration_seconds: 0,
        },
      ],
    }), tempDir);

    await runtimeStore.saveTicketRuntime({
      runtime_version: 1,
      created_at: '2026-05-13T15:00:00.000Z',
      updated_at: '2026-05-13T15:00:00.000Z',
      ticket_key: 'PROJ-LIVE',
      state: 'CONTEXT_IMPORTED',
      summary: 'Observe live runtime',
      jira_status: 'In Progress',
      assignee: 'Live Dev',
      active_session_id: 'sess-live',
    }, tempDir);

    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: '2026-05-13T15:00:00.000Z',
      updated_at: '2026-05-13T15:00:00.000Z',
      session_id: 'sess-live',
      ticket_key: 'PROJ-LIVE',
      developer_id: 'live@example.com',
      started_at: '2026-05-13T15:00:00.000Z',
      ended_at: null,
      state: 'ACTIVE',
      command: 'purpose',
      cwd: tempDir,
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'implementation',
      current_cycle: 0,
      last_timer_status: 'running',
    }, tempDir);

    const secondAsset = await service.getSiteAsset('/monitoring-data.json', {
      projectDir: tempDir,
      title: 'Live Monitoring',
    });
    expect(secondAsset.statusCode).toBe(200);
    const secondSnapshot = JSON.parse(secondAsset.body) as {
      live: { active_sessions: number; active_tickets: number };
      active_sessions: Array<{ ticket_key: string; session_state: string }>;
      live_tickets: Array<{ ticket_key: string; session_state: string }>;
    };

    expect(secondSnapshot.live.active_sessions).toBe(1);
    expect(secondSnapshot.live.active_tickets).toBe(1);
    expect(secondSnapshot.active_sessions[0]?.ticket_key).toBe('PROJ-LIVE');
    expect(secondSnapshot.active_sessions[0]?.session_state).toBe('ACTIVE');
    expect(secondSnapshot.live_tickets[0]?.ticket_key).toBe('PROJ-LIVE');
    expect(secondSnapshot.live_tickets[0]?.session_state).toBe('ACTIVE');
  });
});
