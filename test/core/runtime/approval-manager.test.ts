import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ApprovalManager } from '../../../src/core/runtime/approvals/ApprovalManager.js';
import { RuntimeStore } from '../../../src/storage/fs/RuntimeStore.js';

describe('ApprovalManager', () => {
  let tempDir: string;
  let originalCwd: string;
  let runtimeStore: RuntimeStore;
  let approvalManager: ApprovalManager;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-approval-test-')));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    runtimeStore = new RuntimeStore();
    approvalManager = new ApprovalManager(runtimeStore);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects stale implementation approvals without regressing validated runtime state', async () => {
    const timestamp = new Date('2026-04-22T15:00:00.000Z').toISOString();

    await runtimeStore.saveTicketRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      ticket_key: 'PROJ-123',
      state: 'READY_FOR_ARCHIVE',
      summary: 'Validated runtime change',
      active_session_id: 'sess-1',
      active_change_name: 'runtime-change',
    });
    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      session_id: 'sess-1',
      ticket_key: 'PROJ-123',
      developer_id: 'dev@example.com',
      started_at: timestamp,
      ended_at: null,
      state: 'ACTIVE',
      command: 'purpose',
      cwd: tempDir,
      change_name: 'runtime-change',
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'implementation',
      current_cycle: 6,
      last_timer_status: 'running',
    });
    await runtimeStore.saveChangeRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      change_name: 'runtime-change',
      ticket_key: 'PROJ-123',
      state: 'VALIDATED',
      validation_status: 'PASSED',
      archive_eligible: true,
      worklog_eligible: true,
    });
    await runtimeStore.saveApprovalRequest({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      approval_id: 'approval-implementation-1',
      ticket_key: 'PROJ-123',
      session_id: 'sess-1',
      change_name: 'runtime-change',
      scope: 'implementation',
      reason: 'Implementation exceeded budget',
      evidence_refs: [],
      status: 'PENDING',
      resolved_at: null,
    });

    const resolved = await approvalManager.resolveApproval(
      'approval-implementation-1',
      'REJECTED',
      'stale implementation approval after successful rerun'
    );

    expect(resolved.status).toBe('REJECTED');
    expect((await runtimeStore.getTicketRuntime('PROJ-123'))?.state).toBe('READY_FOR_ARCHIVE');
    expect((await runtimeStore.getSessionRuntime('PROJ-123'))?.state).toBe('ACTIVE');
    expect((await runtimeStore.getChangeRuntime('PROJ-123', 'runtime-change'))?.state).toBe('VALIDATED');
  });
});
