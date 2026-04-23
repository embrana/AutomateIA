import { afterAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { runCLI } from '../helpers/run-cli.js';
import { ArtifactManager } from '../../src/core/runtime/artifacts/ArtifactManager.js';
import { RuntimeStore } from '../../src/storage/fs/RuntimeStore.js';

const tempRoots: string[] = [];
const TIMESTAMP = '2026-04-22T15:00:00.000Z';

async function createProjectDir(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-runtime-explain-cli-'));
  tempRoots.push(base);
  const projectDir = path.join(base, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  return projectDir;
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('runtime explain CLI', () => {
  it('keeps runtime explain --json output machine-readable and actionable', async () => {
    const projectDir = await createProjectDir();
    const runtimeStore = new RuntimeStore();
    const artifactManager = new ArtifactManager(runtimeStore, projectDir);
    const ticketKey = 'PROJ-410';
    const changeName = 'cli-runtime-explain';

    await runtimeStore.saveTicketRuntime({
      runtime_version: 1,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
      ticket_key: ticketKey,
      state: 'READY_FOR_ARCHIVE',
      summary: 'Validate runtime explain CLI output',
      active_session_id: 'sess-cli',
      active_change_name: changeName,
    }, projectDir);

    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
      session_id: 'sess-cli',
      ticket_key: ticketKey,
      developer_id: 'dev@example.com',
      started_at: TIMESTAMP,
      ended_at: null,
      state: 'ACTIVE',
      command: 'purpose',
      cwd: projectDir,
      change_name: changeName,
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'implementation',
      current_cycle: 1,
      last_timer_status: 'running',
    }, projectDir);

    await runtimeStore.saveChangeRuntime({
      runtime_version: 1,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
      change_name: changeName,
      ticket_key: ticketKey,
      state: 'VALIDATED',
      validation_status: 'PASSED',
      archive_eligible: true,
      worklog_eligible: true,
    }, projectDir);

    await runtimeStore.saveExecutionCycle({
      runtime_version: 1,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
      cycle_id: 'cycle-001',
      session_id: 'sess-cli',
      ticket_key: ticketKey,
      change_name: changeName,
      iteration_no: 1,
      started_at: TIMESTAMP,
      ended_at: TIMESTAMP,
      state: 'PASSED',
      initiated_by: 'agent',
      trigger_reason: 'cli-test',
    }, projectDir);

    const archiveDecisionRef = await artifactManager.writeChangeJson(ticketKey, changeName, 'delivery', 'archive-decision.json', {
      archive_ready: true,
      archive_allowed: true,
      worklog_allowed: true,
      approval_required: false,
      blocking_reasons: [],
    });

    const result = await runCLI(['runtime', 'explain', '--json'], { cwd: projectDir });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout);
    expect(payload.found).toBe(true);
    expect(payload.snapshot.ticket).toBe(ticketKey);
    expect(payload.snapshot.change).toBe(changeName);
    expect(payload.suggested_next_action.command).toBe('osj archive');
    expect(payload.primary_evidence_ref).toBe(archiveDecisionRef);
    expect(payload.artifact_refs).toContain(archiveDecisionRef);
  });
});
