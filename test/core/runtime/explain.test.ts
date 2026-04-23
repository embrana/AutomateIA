import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { RuntimeExplainCommand } from '../../../src/core/runtime/explain.js';
import { ApprovalManager } from '../../../src/core/runtime/approvals/ApprovalManager.js';
import { ArtifactManager } from '../../../src/core/runtime/artifacts/ArtifactManager.js';
import { SessionManager } from '../../../src/core/runtime/session/SessionManager.js';
import type {
  ChangeRuntime,
  ExecutionCycle,
  SessionRuntime,
  TicketRuntime,
} from '../../../src/core/runtime/types.js';
import { saveActiveSession } from '../../../src/core/timer/store.js';
import { RuntimeStore } from '../../../src/storage/fs/RuntimeStore.js';

const DEFAULT_TICKET = 'PROJ-123';
const DEFAULT_CHANGE = 'runtime-change';
const DEFAULT_TIMESTAMP = '2026-04-22T15:00:00.000Z';

interface SeedRuntimeOptions {
  ticketKey?: string;
  changeName?: string;
  timestamp?: string;
  ticketState: TicketRuntime['state'];
  sessionState: SessionRuntime['state'];
  changeState: ChangeRuntime['state'];
  validationStatus: ChangeRuntime['validation_status'];
  archiveEligible: boolean;
  worklogEligible?: boolean;
  currentCycleState?: ExecutionCycle['state'];
  currentCycleNumber?: number;
  activeTimer?: boolean;
}

describe('RuntimeExplainCommand', () => {
  let tempDir: string;
  let originalCwd: string;
  let runtimeStore: RuntimeStore;
  let artifactManager: ArtifactManager;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-runtime-explain-test-')));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    runtimeStore = new RuntimeStore();
    artifactManager = new ArtifactManager(runtimeStore, tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reports retryable validation failure and points back to implementation', async () => {
    const { ticketKey, changeName } = await seedRuntime({
      ticketState: 'VALIDATION_FAILED',
      sessionState: 'ACTIVE',
      changeState: 'ARCHIVE_BLOCKED',
      validationStatus: 'FAILED',
      archiveEligible: false,
      currentCycleState: 'FAILED_RETRYABLE',
      currentCycleNumber: 2,
    });

    await artifactManager.writeChangeJson(ticketKey, changeName, 'validation', 'validation-result.json', {
      validation_result: 'FAILED',
      failure_classification: 'RETRYABLE_IMPLEMENTATION_ERROR',
      archive_eligible: false,
      reasons: ['Unit tests are still failing in the active change.'],
    });

    const explanation = await createCommand().explain();

    expect(explanation.found).toBe(true);
    expect(explanation.source).toBe('latest_runtime');
    expect(explanation.explanation?.primary_reason).toContain('Unit tests are still failing');
    expect(explanation.blockers.some((blocker) => blocker.kind === 'validation')).toBe(true);
    expect(explanation.suggested_next_action?.route).toBe('implementation');
    expect(explanation.suggested_next_action?.command).toBe('osj orchestrate --until implementation');
    expect(explanation.artifact_refs).toContain(artifactManager.getValidationRef(ticketKey, changeName));
  });

  it('reports pending archive approval with actionable commands', async () => {
    const { ticketKey, changeName } = await seedRuntime({
      ticketState: 'HUMAN_ESCALATION_REQUIRED',
      sessionState: 'AWAITING_HUMAN',
      changeState: 'VALIDATED',
      validationStatus: 'PASSED',
      archiveEligible: false,
    });

    const closureRef = await artifactManager.writeChangeJson(ticketKey, changeName, 'delivery', 'closure-summary.json', {
      completed_scope: ['Implemented runtime explain'],
      remaining_risks: ['Archive requires manual approval'],
      worklog_preview: ['implementation: explain runtime'],
    });
    const decisionRef = await artifactManager.writeChangeJson(ticketKey, changeName, 'delivery', 'archive-decision.json', {
      archive_ready: true,
      archive_allowed: false,
      worklog_allowed: true,
      approval_required: true,
      approval_status: 'PENDING',
      blocking_reasons: ['Archive requires human approval under the current autonomy policy.'],
    });

    await runtimeStore.saveApprovalRequest({
      runtime_version: 1,
      created_at: DEFAULT_TIMESTAMP,
      updated_at: DEFAULT_TIMESTAMP,
      approval_id: 'approval-archive-1',
      ticket_key: ticketKey,
      session_id: 'sess-1',
      change_name: changeName,
      scope: 'archive',
      reason: 'Archive requires human approval under the current autonomy policy.',
      evidence_refs: [closureRef, decisionRef],
      status: 'PENDING',
      resolved_at: null,
    });

    const explanation = await createCommand().explain();

    expect(explanation.pending_approvals).toHaveLength(1);
    expect(explanation.pending_approvals[0].suggested_commands.show).toBe('osj approval show');
    expect(explanation.pending_approvals[0].suggested_commands.accept).toContain('osj approval accept approval-archive-1');
    expect(explanation.pending_approvals[0].suggested_commands.reject).toContain('osj approval reject approval-archive-1');
    expect(explanation.suggested_next_action?.route).toBe('approval');
    expect(explanation.suggested_next_action?.command).toBe('osj approval show');
    expect(explanation.primary_evidence_ref).toBe(closureRef);
  });

  it('renders human-readable approval guidance', async () => {
    const { ticketKey, changeName } = await seedRuntime({
      ticketState: 'HUMAN_ESCALATION_REQUIRED',
      sessionState: 'AWAITING_HUMAN',
      changeState: 'VALIDATED',
      validationStatus: 'PASSED',
      archiveEligible: false,
    });

    const closureRef = await artifactManager.writeChangeJson(ticketKey, changeName, 'delivery', 'closure-summary.json', {
      completed_scope: ['Prepared closeout artifacts'],
      remaining_risks: ['Archive is still pending manual approval'],
    });

    await runtimeStore.saveApprovalRequest({
      runtime_version: 1,
      created_at: DEFAULT_TIMESTAMP,
      updated_at: DEFAULT_TIMESTAMP,
      approval_id: 'approval-archive-human',
      ticket_key: ticketKey,
      session_id: 'sess-1',
      change_name: changeName,
      scope: 'archive',
      reason: 'Archive requires human approval under the current autonomy policy.',
      evidence_refs: [closureRef],
      status: 'PENDING',
      resolved_at: null,
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    let output = '';
    try {
      await createCommand().execute();
      output = consoleLogSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    } finally {
      consoleLogSpy.mockRestore();
    }

    expect(output).toContain('Pending approvals:');
    expect(output).toContain('approval-archive-human [archive]: Archive requires human approval under the current autonomy policy.');
    expect(output).toContain('show: osj approval show');
    expect(output).toContain('accept: osj approval accept approval-archive-human --reason "approved by developer"');
    expect(output).toContain('reject: osj approval reject approval-archive-human --reason "rejected by developer"');
    expect(output).toContain(`Primary evidence: ${closureRef}`);
  });

  it('reports ready for archive and suggests osj archive', async () => {
    const { ticketKey, changeName } = await seedRuntime({
      ticketState: 'READY_FOR_ARCHIVE',
      sessionState: 'ACTIVE',
      changeState: 'VALIDATED',
      validationStatus: 'PASSED',
      archiveEligible: true,
    });

    await artifactManager.writeChangeJson(ticketKey, changeName, 'delivery', 'archive-decision.json', {
      archive_ready: true,
      archive_allowed: true,
      worklog_allowed: true,
      approval_required: false,
      blocking_reasons: [],
    });

    const explanation = await createCommand().explain();

    expect(explanation.blockers).toHaveLength(0);
    expect(explanation.suggested_next_action?.route).toBe('archive');
    expect(explanation.suggested_next_action?.command).toBe('osj archive');
    expect(explanation.explanation?.primary_reason).toContain('archive is allowed');
  });

  it('falls back to latest runtime when there is no active session', async () => {
    const { ticketKey } = await seedRuntime({
      ticketKey: 'PROJ-200',
      changeName: 'latest-runtime',
      ticketState: 'READY_FOR_ARCHIVE',
      sessionState: 'ACTIVE',
      changeState: 'VALIDATED',
      validationStatus: 'PASSED',
      archiveEligible: true,
    });

    const explanation = await createCommand().explain();

    expect(explanation.source).toBe('latest_runtime');
    expect(explanation.snapshot?.ticket).toBe(ticketKey);
  });

  it('prefers the active timer session over later persisted runtime snapshots', async () => {
    await seedRuntime({
      ticketKey: 'PROJ-300',
      changeName: 'active-ticket',
      timestamp: '2026-04-22T10:00:00.000Z',
      ticketState: 'IN_EXECUTION',
      sessionState: 'ACTIVE',
      changeState: 'IN_IMPLEMENTATION',
      validationStatus: 'PENDING',
      archiveEligible: false,
      activeTimer: true,
    });

    await seedRuntime({
      ticketKey: 'PROJ-301',
      changeName: 'latest-ticket',
      timestamp: '2026-04-22T20:00:00.000Z',
      ticketState: 'READY_FOR_ARCHIVE',
      sessionState: 'ACTIVE',
      changeState: 'VALIDATED',
      validationStatus: 'PASSED',
      archiveEligible: true,
    });

    const explanation = await createCommand().explain();

    expect(explanation.source).toBe('active_timer');
    expect(explanation.snapshot?.ticket).toBe('PROJ-300');
  });

  it('returns a friendly response when runtime state is missing', async () => {
    const explanation = await createCommand().explain();

    expect(explanation.found).toBe(false);
    expect(explanation.message).toContain('No OpenSpec runtime state found');
    expect(explanation.blockers).toEqual([]);
    expect(explanation.pending_approvals).toEqual([]);
  });

  function createCommand(): RuntimeExplainCommand {
    return new RuntimeExplainCommand(
      new SessionManager(runtimeStore),
      runtimeStore,
      new ApprovalManager(runtimeStore),
      artifactManager
    );
  }

  async function seedRuntime(options: SeedRuntimeOptions): Promise<{ ticketKey: string; changeName: string }> {
    const ticketKey = options.ticketKey ?? DEFAULT_TICKET;
    const changeName = options.changeName ?? DEFAULT_CHANGE;
    const timestamp = options.timestamp ?? DEFAULT_TIMESTAMP;
    const currentCycleNumber = options.currentCycleNumber ?? (options.currentCycleState ? 1 : 0);

    await runtimeStore.saveTicketRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      ticket_key: ticketKey,
      state: options.ticketState,
      summary: `Runtime state for ${ticketKey}`,
      active_session_id: 'sess-1',
      active_change_name: changeName,
    });
    await runtimeStore.saveSessionRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      session_id: 'sess-1',
      ticket_key: ticketKey,
      developer_id: 'dev@example.com',
      started_at: timestamp,
      ended_at: null,
      state: options.sessionState,
      command: 'purpose',
      cwd: tempDir,
      change_name: changeName,
      autonomy_level: 'L2_ASSISTED',
      active_mode: 'human',
      active_kind: 'implementation',
      current_cycle: currentCycleNumber,
      last_timer_status: 'running',
    });
    await runtimeStore.saveChangeRuntime({
      runtime_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      change_name: changeName,
      ticket_key: ticketKey,
      state: options.changeState,
      validation_status: options.validationStatus,
      archive_eligible: options.archiveEligible,
      worklog_eligible: options.worklogEligible ?? true,
      last_archive_reason: options.changeState === 'ARCHIVE_BLOCKED'
        ? 'Archive is blocked until validation issues are fixed.'
        : undefined,
    });

    if (options.currentCycleState) {
      await runtimeStore.saveExecutionCycle({
        runtime_version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        cycle_id: `cycle-${String(currentCycleNumber).padStart(3, '0')}`,
        session_id: 'sess-1',
        ticket_key: ticketKey,
        change_name: changeName,
        iteration_no: currentCycleNumber,
        started_at: timestamp,
        ended_at: options.currentCycleState === 'RUNNING' ? undefined : timestamp,
        state: options.currentCycleState,
        initiated_by: 'agent',
        trigger_reason: 'test-seed',
      });
    }

    if (options.activeTimer) {
      await saveActiveSession({
        session_id: 'sess-1',
        jira_issue_key: ticketKey,
        jira_ticket: {
          key: ticketKey,
          summary: `Runtime state for ${ticketKey}`,
          status: 'In Progress',
          assignee: null,
          description_text: 'Runtime explain test fixture',
          url: `https://example.atlassian.net/browse/${ticketKey}`,
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
          description: 'Seeded runtime session',
          source: 'manual',
          started_at: timestamp,
          started_at_local: timestamp,
        },
        blocks: [
          {
            block_id: 'block-1',
            actor_mode: 'human',
            work_kind: 'implementation',
            description: 'Seeded runtime session',
            source: 'manual',
            started_at: timestamp,
            started_at_local: timestamp,
          },
        ],
      });
    }

    return { ticketKey, changeName };
  }
});
