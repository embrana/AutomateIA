import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { saveGlobalConfig } from '../../../src/core/global-config.js';
import { purpose } from '../../../src/core/timer/commands.js';
import { saveActiveSession } from '../../../src/core/timer/store.js';
import { ArtifactManager } from '../../../src/core/runtime/artifacts/ArtifactManager.js';
import { RuntimeStatusCommand } from '../../../src/core/runtime/status.js';
import { RuntimeStore } from '../../../src/storage/fs/RuntimeStore.js';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('RuntimeStatusCommand', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-runtime-status-test-')));
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
  });

  afterEach(async () => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.chdir(originalCwd);
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('renders the current runtime snapshot as JSON', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement runtime status command',
        status: { name: 'In Progress' },
        assignee: null,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Expose runtime state from the CLI.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    consoleLogSpy.mockClear();

    const command = new RuntimeStatusCommand();
    await command.execute({ json: true });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(payload.ticket.ticket_key).toBe('PROJ-123');
    expect(payload.ticket.state).toBe('CONTEXT_IMPORTED');
    expect(payload.session.state).toBe('ACTIVE');
    expect(payload.source).toBe('active_timer');
  });

  it('shows runtime activity when an agent cycle is running', async () => {
    const timestamp = '2026-04-23T03:19:22.283Z';
    const runtimeStore = new RuntimeStore();
    const artifactManager = new ArtifactManager(runtimeStore, tempDir);

    await saveActiveSession({
      session_id: 'sess-runtime-status',
      jira_issue_key: 'REB-232',
      jira_ticket: {
        key: 'REB-232',
        summary: 'Improve orchestrate terminal summaries',
        status: 'In Progress',
        assignee: 'Emiliano',
        description_text: 'Structured runtime test fixture',
        url: 'https://example.atlassian.net/browse/REB-232',
      },
      openspec_change: {
        name: 'reb-232-runtime-status',
        path: path.join(tempDir, 'openspec', 'changes', 'reb-232-runtime-status'),
        schema: 'spec-driven',
      },
      started_at: timestamp,
      started_at_local: timestamp,
      user_email: 'dev@example.com',
      status: 'running',
      command: 'purpose',
      cwd: tempDir,
      notes: null,
      current_block: {
        block_id: 'block-1',
        actor_mode: 'human',
        work_kind: 'implementation',
        description: 'Review runtime state',
        source: 'manual',
        started_at: timestamp,
        started_at_local: timestamp,
      },
      blocks: [
        {
          block_id: 'block-1',
          actor_mode: 'human',
          work_kind: 'implementation',
          description: 'Review runtime state',
          source: 'manual',
          started_at: timestamp,
          started_at_local: timestamp,
        },
      ],
    });

    await runtimeStore.saveTicketRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      ticket_key: 'REB-232',
      state: 'PLANNED',
      summary: 'Improve orchestrate terminal summaries',
      active_session_id: 'sess-runtime-status',
      active_change_name: 'reb-232-runtime-status',
    });

    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      session_id: 'sess-runtime-status',
      ticket_key: 'REB-232',
      developer_id: 'dev@example.com',
      started_at: timestamp,
      ended_at: null,
      state: 'ACTIVE',
      command: 'purpose',
      cwd: tempDir,
      change_name: 'reb-232-runtime-status',
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'implementation',
      current_cycle: 1,
      last_timer_status: 'running',
    });

    await runtimeStore.saveChangeRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      change_name: 'reb-232-runtime-status',
      ticket_key: 'REB-232',
      state: 'TASKED',
      validation_status: 'PENDING',
      archive_eligible: false,
      worklog_eligible: true,
    });

    await runtimeStore.saveExecutionCycle({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      cycle_id: 'cycle-001',
      session_id: 'sess-runtime-status',
      ticket_key: 'REB-232',
      change_name: 'reb-232-runtime-status',
      iteration_no: 1,
      started_at: timestamp,
      state: 'RUNNING',
      initiated_by: 'agent',
      trigger_reason: 'implementation_agent_started',
    });

    await artifactManager.writeAgentRun('REB-232', 'reb-232-runtime-status', {
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      agent_run_id: 'run-implementation',
      agent_name: 'implementation_agent',
      session_id: 'sess-runtime-status',
      ticket_key: 'REB-232',
      cycle_id: 'cycle-001',
      status: 'RUNNING',
      started_at: timestamp,
      ended_at: null,
      input_ref: '.openspec/runtime/tickets/REB-232/context/normalized-context.json',
    });

    consoleLogSpy.mockClear();

    const command = new RuntimeStatusCommand();
    await command.execute();

    const output = consoleLogSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(output).toContain('Activity: ai_autonomous / implementation');
    expect(output).toContain('Running agent: implementation_agent');
    expect(output).toContain('Timer block: human / implementation');
  });
});
