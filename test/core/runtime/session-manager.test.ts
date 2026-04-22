import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { saveGlobalConfig } from '../../../src/core/global-config.js';
import { cancel, pause, purpose, resume } from '../../../src/core/timer/commands.js';
import { getActiveSession } from '../../../src/core/timer/store.js';
import { RuntimeStore } from '../../../src/storage/fs/RuntimeStore.js';
import { SessionManager } from '../../../src/core/runtime/session/SessionManager.js';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('SessionManager runtime bridge', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;
  let runtimeStore: RuntimeStore;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-runtime-test-')));
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    process.chdir(tempDir);
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config-home');

    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://example.atlassian.net',
        email: 'dev@example.com',
        api_token: 'token',
      },
      worklog: {
        rounding: 'minute',
        min_seconds: 60,
        comment_template: 'OpenSpec execution session',
        track_metadata_locally: true,
      },
    });

    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
    runtimeStore = new RuntimeStore();
    sessionManager = new SessionManager(runtimeStore);
  });

  afterEach(async () => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.chdir(originalCwd);
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates ticket, session, and change runtime state from a Jira-backed purpose flow', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement runtime-backed orchestration',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Create runtime state from a Jira session.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true, createChange: true });

    const snapshot = await runtimeStore.getLatestRuntimeSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.ticket).toMatchObject({
      ticket_key: 'PROJ-123',
      state: 'SPEC_READY',
      summary: 'Implement runtime-backed orchestration',
      assignee: 'Emiliano',
    });
    expect(snapshot?.session).toMatchObject({
      ticket_key: 'PROJ-123',
      state: 'ACTIVE',
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'implementation',
      current_cycle: 0,
    });
    expect(snapshot?.change).toMatchObject({
      ticket_key: 'PROJ-123',
      state: 'TASKED',
      validation_status: 'PENDING',
      archive_eligible: false,
    });

    const ticketFile = runtimeStore.getTicketRuntimePath('PROJ-123');
    const sessionFile = runtimeStore.getSessionRuntimePath('PROJ-123');
    expect(await fs.readFile(ticketFile, 'utf-8')).toContain('"state": "SPEC_READY"');
    expect(await fs.readFile(sessionFile, 'utf-8')).toContain('"state": "ACTIVE"');
  });

  it('tracks pause, resume, and cancel transitions in runtime state', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-21T14:15:00.000Z'));
    await pause();
    expect((await runtimeStore.getSessionRuntime('PROJ-123'))?.state).toBe('PAUSED');

    vi.setSystemTime(new Date('2026-04-21T14:20:00.000Z'));
    await resume();
    expect((await runtimeStore.getSessionRuntime('PROJ-123'))?.state).toBe('ACTIVE');

    vi.setSystemTime(new Date('2026-04-21T14:25:00.000Z'));
    await cancel();

    const latest = await runtimeStore.getLatestRuntimeSnapshot();
    expect(latest?.session.state).toBe('CANCELLED');
    expect(latest?.ticket.state).toBe('DISCOVERED');
  });

  it('starts a fresh runtime session after cancelling the previous session for the same ticket', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ key: 'PROJ-123' }));

    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    await purpose('PROJ-123');
    const firstSession = await runtimeStore.getSessionRuntime('PROJ-123');
    expect(firstSession?.state).toBe('ACTIVE');

    vi.setSystemTime(new Date('2026-04-21T14:25:00.000Z'));
    await cancel();
    const cancelledSession = await runtimeStore.getSessionRuntime('PROJ-123');
    expect(cancelledSession?.state).toBe('CANCELLED');
    expect(cancelledSession?.ended_at).not.toBeNull();

    vi.setSystemTime(new Date('2026-04-21T14:30:00.000Z'));
    await purpose('PROJ-123');

    const reopenedSession = await runtimeStore.getSessionRuntime('PROJ-123');
    expect(reopenedSession).toMatchObject({
      ticket_key: 'PROJ-123',
      state: 'ACTIVE',
      current_cycle: 0,
      ended_at: null,
    });
    expect(reopenedSession?.session_id).not.toBe(firstSession?.session_id);
    expect(reopenedSession?.created_at).not.toBe(firstSession?.created_at);
  });

  it('records blocked and successful archive outcomes on runtime state', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement runtime-backed orchestration',
        status: { name: 'In Progress' },
        assignee: null,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Create runtime state from a Jira session.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true, createChange: true });
    const changeName = (await runtimeStore.getSessionRuntime('PROJ-123'))?.change_name;
    expect(changeName).toBeTruthy();

    await sessionManager.recordArchiveOutcome({
      ticketKey: 'PROJ-123',
      changeName: changeName!,
      archived: false,
      reason: 'Tasks remain incomplete',
    });
    expect((await runtimeStore.getTicketRuntime('PROJ-123'))?.state).toBe('BLOCKED');
    expect((await runtimeStore.getChangeRuntime('PROJ-123', changeName!))?.state).toBe('ARCHIVE_BLOCKED');

    await sessionManager.recordArchiveOutcome({
      ticketKey: 'PROJ-123',
      changeName: changeName!,
      archived: true,
      archiveName: `2026-04-21-${changeName}`,
    });
    expect((await runtimeStore.getTicketRuntime('PROJ-123'))?.state).toBe('ARCHIVED');
    expect((await runtimeStore.getChangeRuntime('PROJ-123', changeName!))?.state).toBe('ARCHIVED');
  });

  it('can record archive outcome for a change without an active timer session lookup', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Archive by change lookup',
        status: { name: 'In Progress' },
        assignee: null,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Archive a change after the timer has been closed.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true, createChange: true });
    const changeName = (await runtimeStore.getSessionRuntime('PROJ-123'))?.change_name;
    expect(changeName).toBeTruthy();

    await sessionManager.recordArchiveOutcome({
      ticketKey: 'PROJ-123',
      changeName: changeName!,
      archived: true,
      archiveName: `2026-04-21-${changeName}`,
    });

    const archived = await sessionManager.recordArchiveOutcomeForChange({
      changeName: changeName!,
      archived: true,
      archiveName: `2026-04-21-${changeName}`,
    });

    expect(archived?.state).toBe('ARCHIVED');
    expect((await runtimeStore.getTicketRuntime('PROJ-123'))?.state).toBe('ARCHIVED');
    expect((await runtimeStore.getChangeRuntime('PROJ-123', changeName!))?.state).toBe('ARCHIVED');
  });

  it('keeps ticket state aligned with change state on active-session refresh', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Keep ticket and change states aligned',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'The ticket state should follow the active change state.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true, createChange: true });
    const activeSession = await getActiveSession();
    expect(activeSession?.openspec_change?.name).toBeTruthy();

    await sessionManager.syncFromTimerSession(activeSession!, {
      overrideTicketState: 'PLANNED',
      overrideChangeState: 'UNDER_REVIEW',
    });

    const refreshed = await sessionManager.getCurrentRuntimeSnapshot();
    expect(refreshed?.ticket.state).toBe('UNDER_REVIEW');
    expect(refreshed?.change?.state).toBe('UNDER_REVIEW');
  });
});
