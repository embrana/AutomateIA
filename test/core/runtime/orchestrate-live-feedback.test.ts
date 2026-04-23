import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { saveActiveSession } from '../../../src/core/timer/store.js';
import { RuntimeStore } from '../../../src/storage/fs/RuntimeStore.js';
import {
  buildOrchestrateHeartbeatLine,
  collectOrchestrateHeartbeat,
} from '../../../src/core/runtime/orchestrate-live-feedback.js';

describe('orchestrate live feedback', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-live-feedback-test-')));
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    process.chdir(tempDir);
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config-home');
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    process.chdir(originalCwd);
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedRunningImplementationRuntime(runId = 'run-123'): Promise<RuntimeStore> {
    const runtimeStore = new RuntimeStore();
    const timestamp = '2026-04-23T03:00:00.000Z';
    const changeName = 'reb-233-live-feedback';

    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'feature.ts'), 'export const liveFeedback = false;\n', 'utf-8');
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email dev@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "OpenSpec Tests"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });

    await saveActiveSession({
      session_id: 'sess-live-feedback',
      jira_issue_key: 'REB-233',
      jira_ticket: {
        key: 'REB-233',
        summary: 'Show live orchestrate feedback',
        status: 'In Progress',
        assignee: 'Emiliano',
        description_text: 'Structured runtime fixture',
        url: 'https://example.atlassian.net/browse/REB-233',
      },
      openspec_change: {
        name: changeName,
        path: path.join(tempDir, 'openspec', 'changes', changeName),
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
        description: 'Run live feedback fixture',
        source: 'manual',
        started_at: timestamp,
        started_at_local: timestamp,
      },
      blocks: [
        {
          block_id: 'block-1',
          actor_mode: 'human',
          work_kind: 'implementation',
          description: 'Run live feedback fixture',
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
      ticket_key: 'REB-233',
      state: 'IN_EXECUTION',
      summary: 'Show live orchestrate feedback',
      active_session_id: 'sess-live-feedback',
      active_change_name: changeName,
    });

    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      session_id: 'sess-live-feedback',
      ticket_key: 'REB-233',
      developer_id: 'dev@example.com',
      started_at: timestamp,
      ended_at: null,
      state: 'ACTIVE',
      command: 'purpose',
      cwd: tempDir,
      change_name: changeName,
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
      change_name: changeName,
      ticket_key: 'REB-233',
      state: 'IN_IMPLEMENTATION',
      validation_status: 'PENDING',
      archive_eligible: false,
      worklog_eligible: true,
    });

    await runtimeStore.saveExecutionCycle({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      cycle_id: 'cycle-001',
      session_id: 'sess-live-feedback',
      ticket_key: 'REB-233',
      change_name: changeName,
      iteration_no: 1,
      started_at: timestamp,
      ended_at: null,
      state: 'RUNNING',
      initiated_by: 'system',
      trigger_reason: 'implementation',
    });

    const agentRunsDir = runtimeStore.getAgentRunsDir('REB-233', changeName, tempDir);
    await fs.mkdir(agentRunsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentRunsDir, `${runId}.json`),
      `${JSON.stringify(
        {
          runtime_version: 1,
          created_at: timestamp,
          updated_at: timestamp,
          agent_run_id: runId,
          agent_name: 'implementation_agent',
          session_id: 'sess-live-feedback',
          ticket_key: 'REB-233',
          cycle_id: 'cycle-001',
          status: 'RUNNING',
          started_at: timestamp,
        },
        null,
        2
      )}\n`,
      'utf-8'
    );

    return runtimeStore;
  }

  it('infers thinking when implementation is running without visible edits', async () => {
    vi.setSystemTime(new Date('2026-04-23T03:00:20.000Z'));
    await seedRunningImplementationRuntime();

    const heartbeat = await collectOrchestrateHeartbeat(tempDir);

    expect(heartbeat).toMatchObject({
      activeAgent: 'implementation_agent',
      cycleId: 'cycle-001',
      phase: 'thinking',
      phaseSource: 'inferred',
      addedLines: 0,
      removedLines: 0,
      inputTokens: null,
      outputTokens: null,
    });
    expect(buildOrchestrateHeartbeatLine(heartbeat!)).toContain('no workspace edits detected yet');
  });

  it('infers writing when implementation is running and workspace edits exist', async () => {
    vi.setSystemTime(new Date('2026-04-23T03:00:20.000Z'));
    await seedRunningImplementationRuntime();
    await fs.writeFile(path.join(tempDir, 'src', 'feature.ts'), 'export const liveFeedback = true;\n', 'utf-8');

    const heartbeat = await collectOrchestrateHeartbeat(tempDir);

    expect(heartbeat?.phase).toBe('writing');
    expect(heartbeat?.phaseSource).toBe('inferred');
    expect((heartbeat?.addedLines ?? 0) + (heartbeat?.removedLines ?? 0)).toBeGreaterThan(0);
    expect(buildOrchestrateHeartbeatLine(heartbeat!)).toContain('diff +');
  });

  it('uses strict backend phase and exact tokens when fresh progress exists', async () => {
    vi.setSystemTime(new Date('2026-04-23T03:00:20.000Z'));
    const runtimeStore = await seedRunningImplementationRuntime('run-456');
    const progressPath = runtimeStore.getLiveProgressPath('REB-233', 'reb-233-live-feedback', 'run-456', tempDir);
    await fs.mkdir(path.dirname(progressPath), { recursive: true });
    await fs.writeFile(
      progressPath,
      `${JSON.stringify(
        {
          agent_name: 'implementation_agent',
          run_id: 'run-456',
          phase: 'thinking',
          phase_source: 'backend',
          input_tokens: 321,
          output_tokens: 89,
          updated_at: '2026-04-23T03:00:15.000Z',
        },
        null,
        2
      )}\n`,
      'utf-8'
    );

    const heartbeat = await collectOrchestrateHeartbeat(tempDir);

    expect(heartbeat).toMatchObject({
      phase: 'thinking',
      phaseSource: 'backend',
      inputTokens: 321,
      outputTokens: 89,
    });
    expect(buildOrchestrateHeartbeatLine(heartbeat!)).toContain('tokens_in=321');
    expect(buildOrchestrateHeartbeatLine(heartbeat!)).toContain('tokens_out=89');
  });
});
