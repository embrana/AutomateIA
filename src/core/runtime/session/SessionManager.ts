import path from 'path';
import type { TimerBlock, TimerSession } from '../../timer/types.js';
import { StateEngine } from '../state/StateEngine.js';
import {
  RUNTIME_LAYOUT_VERSION,
  type AutonomyLevel,
  type ChangeRuntime,
  type ChangeRuntimeState,
  type RuntimeActivityMode,
  type RuntimeSnapshot,
  type RuntimeWorkKind,
  type SessionRuntime,
  type SessionRuntimeState,
  type TicketRuntime,
  type TicketRuntimeState,
  type ValidationStatus,
} from '../types.js';
import { RuntimeStore } from '../../../storage/fs/RuntimeStore.js';
import { getActiveSession } from '../../timer/store.js';

interface SessionSyncOptions {
  overrideSessionState?: SessionRuntimeState;
  overrideTicketState?: TicketRuntimeState;
  overrideChangeState?: ChangeRuntimeState;
  overrideValidationStatus?: ValidationStatus;
  overrideArchiveEligible?: boolean;
  overrideWorklogEligible?: boolean;
  archiveName?: string;
  archiveReason?: string;
  endedAt?: string | null;
}

export class SessionManager {
  constructor(
    private readonly runtimeStore = new RuntimeStore(),
    private readonly stateEngine = new StateEngine()
  ) {}

  async syncFromTimerSession(session: TimerSession, options: SessionSyncOptions = {}): Promise<RuntimeSnapshot> {
    const ticketKey = session.jira_issue_key;
    const persistedTicket = await this.runtimeStore.getTicketRuntime(ticketKey);
    const persistedSession = await this.runtimeStore.getSessionRuntime(ticketKey);
    const previousSession = persistedSession?.session_id === session.session_id
      ? persistedSession
      : null;
    const previousTicket = previousSession ? persistedTicket : null;
    const previousChange = session.openspec_change?.name
      ? await this.runtimeStore.getChangeRuntime(ticketKey, session.openspec_change.name)
      : null;

    const nextSession = this.buildSessionRuntime(session, previousSession, options);
    this.stateEngine.assertSessionTransition(previousSession?.state, nextSession.state);
    await this.runtimeStore.saveSessionRuntime(nextSession);

    let nextChange: ChangeRuntime | undefined;
    if (session.openspec_change?.name) {
      nextChange = this.buildChangeRuntime(session, previousChange ?? undefined, options);
      this.stateEngine.assertChangeTransition(previousChange?.state, nextChange.state);
      await this.runtimeStore.saveChangeRuntime(nextChange);
    }

    const nextTicket = this.buildTicketRuntime(session, previousTicket, nextSession, nextChange, options);
    this.stateEngine.assertTicketTransition(previousTicket?.state, nextTicket.state);
    await this.runtimeStore.saveTicketRuntime(nextTicket);

    return {
      source: 'active_timer',
      runtime_root: this.runtimeStore.getTicketDir(ticketKey),
      ticket: nextTicket,
      session: nextSession,
      change: nextChange,
    };
  }

  async markCancelled(session: TimerSession): Promise<RuntimeSnapshot> {
    const endedAt = new Date().toISOString();
    return this.syncFromTimerSession(session, {
      overrideSessionState: 'CANCELLED',
      endedAt,
    });
  }

  async recordArchiveOutcome(input: {
    ticketKey: string;
    changeName: string;
    archived: boolean;
    archiveName?: string;
    reason?: string;
  }): Promise<ChangeRuntime | null> {
    const ticket = await this.runtimeStore.getTicketRuntime(input.ticketKey);
    const session = await this.runtimeStore.getSessionRuntime(input.ticketKey);
    const previousChange = await this.runtimeStore.getChangeRuntime(input.ticketKey, input.changeName);

    if (!ticket || !session) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    const nextState: ChangeRuntimeState = input.archived ? 'ARCHIVED' : 'ARCHIVE_BLOCKED';
    this.stateEngine.assertChangeTransition(previousChange?.state, nextState);

    const change: ChangeRuntime = {
      runtime_version: RUNTIME_LAYOUT_VERSION,
      created_at: previousChange?.created_at ?? updatedAt,
      updated_at: updatedAt,
      change_name: input.changeName,
      ticket_key: input.ticketKey,
      proposal_path: previousChange?.proposal_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', input.changeName, 'proposal.md')),
      tasks_path: previousChange?.tasks_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', input.changeName, 'tasks.md')),
      jira_ticket_path: previousChange?.jira_ticket_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', input.changeName, 'jira-ticket.md')),
      spec_path: previousChange?.spec_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', input.changeName, 'specs', input.changeName, 'spec.md')),
      state: nextState,
      validation_status: input.archived ? 'PASSED' : 'BLOCKED',
      archive_eligible: input.archived,
      worklog_eligible: previousChange?.worklog_eligible ?? true,
      archive_name: input.archiveName,
      last_archive_reason: input.reason,
    };
    await this.runtimeStore.saveChangeRuntime(change);

    const nextTicketState: TicketRuntimeState = input.archived ? 'ARCHIVED' : 'BLOCKED';
    this.stateEngine.assertTicketTransition(ticket.state, nextTicketState);
    await this.runtimeStore.saveTicketRuntime({
      ...ticket,
      state: nextTicketState,
      active_change_name: input.changeName,
      updated_at: updatedAt,
    });

    return change;
  }

  async recordArchiveOutcomeForChange(input: {
    changeName: string;
    archived: boolean;
    archiveName?: string;
    reason?: string;
  }): Promise<ChangeRuntime | null> {
    const ticketKey = await this.findTicketKeyForChange(input.changeName);
    if (!ticketKey) {
      return null;
    }

    return this.recordArchiveOutcome({
      ticketKey,
      changeName: input.changeName,
      archived: input.archived,
      archiveName: input.archiveName,
      reason: input.reason,
    });
  }

  async findTicketKeyForChange(changeName: string): Promise<string | null> {
    const ticketKeys = await this.runtimeStore.listTicketKeys();
    for (const ticketKey of ticketKeys) {
      const change = await this.runtimeStore.getChangeRuntime(ticketKey, changeName);
      if (change) {
        return ticketKey;
      }
    }
    return null;
  }

  async getCurrentRuntimeSnapshot(): Promise<RuntimeSnapshot | null> {
    const activeTimer = await getActiveSession();
    if (activeTimer) {
      return this.syncFromTimerSession(activeTimer);
    }

    return this.runtimeStore.getLatestRuntimeSnapshot();
  }

  private buildSessionRuntime(
    session: TimerSession,
    previous: SessionRuntime | null,
    options: SessionSyncOptions
  ): SessionRuntime {
    const updatedAt = new Date().toISOString();
    const { activeMode, activeKind } = this.resolveActiveActivity(session);
    const state = options.overrideSessionState ?? this.mapTimerStatus(session.status);
    const endedAt = options.endedAt !== undefined
      ? options.endedAt
      : state === 'CLOSED' || state === 'SYNC_PENDING'
        ? session.ended_at ?? null
        : previous?.ended_at ?? null;

    return {
      runtime_version: RUNTIME_LAYOUT_VERSION,
      created_at: previous?.created_at ?? updatedAt,
      updated_at: updatedAt,
      session_id: session.session_id,
      ticket_key: session.jira_issue_key,
      developer_id: session.user_email,
      started_at: session.started_at,
      ended_at: endedAt,
      state,
      command: session.command,
      cwd: session.cwd,
      change_name: session.openspec_change?.name,
      autonomy_level: this.deriveAutonomyLevel(session),
      active_mode: activeMode,
      active_kind: activeKind,
      worklog_status: session.worklog_status,
      sync_error: session.sync_error,
      current_cycle: previous?.current_cycle ?? 0,
      last_timer_status: session.status,
    };
  }

  private buildTicketRuntime(
    session: TimerSession,
    previous: TicketRuntime | null,
    nextSession: SessionRuntime,
    nextChange: ChangeRuntime | undefined,
    options: SessionSyncOptions
  ): TicketRuntime {
    const updatedAt = new Date().toISOString();
    const state = options.overrideTicketState ?? this.deriveTicketState(session, previous?.state, nextChange);

    return {
      runtime_version: RUNTIME_LAYOUT_VERSION,
      created_at: previous?.created_at ?? updatedAt,
      updated_at: updatedAt,
      ticket_key: session.jira_issue_key,
      state,
      summary: session.jira_ticket?.summary ?? previous?.summary,
      jira_status: session.jira_ticket?.status ?? previous?.jira_status,
      assignee: session.jira_ticket?.assignee ?? previous?.assignee,
      source_url: session.jira_ticket?.url ?? previous?.source_url,
      active_session_id: nextSession.session_id,
      active_change_name: session.openspec_change?.name ?? previous?.active_change_name,
    };
  }

  private buildChangeRuntime(
    session: TimerSession,
    previous: ChangeRuntime | undefined,
    options: SessionSyncOptions
  ): ChangeRuntime {
    const changeName = session.openspec_change!.name;
    const updatedAt = new Date().toISOString();
    const state = options.overrideChangeState ?? this.deriveChangeState(session, previous?.state);
    const validationStatus = options.overrideValidationStatus ?? this.deriveValidationStatus(state, previous?.validation_status);

    return {
      runtime_version: RUNTIME_LAYOUT_VERSION,
      created_at: previous?.created_at ?? updatedAt,
      updated_at: updatedAt,
      change_name: changeName,
      ticket_key: session.jira_issue_key,
      proposal_path: previous?.proposal_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', changeName, 'proposal.md')),
      tasks_path: previous?.tasks_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', changeName, 'tasks.md')),
      jira_ticket_path: previous?.jira_ticket_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', changeName, 'jira-ticket.md')),
      spec_path: previous?.spec_path ?? this.toRuntimeRelativePath(path.join('openspec', 'changes', changeName, 'specs', changeName, 'spec.md')),
      state,
      validation_status: validationStatus,
      archive_eligible: options.overrideArchiveEligible ?? previous?.archive_eligible ?? false,
      worklog_eligible: options.overrideWorklogEligible ?? previous?.worklog_eligible ?? true,
      archive_name: options.archiveName ?? previous?.archive_name,
      last_archive_reason: options.archiveReason ?? previous?.last_archive_reason,
    };
  }

  private mapTimerStatus(status: TimerSession['status']): SessionRuntimeState {
    switch (status) {
      case 'running':
        return 'ACTIVE';
      case 'paused':
        return 'PAUSED';
      case 'sync_pending':
        return 'SYNC_PENDING';
      case 'closed':
        return 'CLOSED';
      default:
        return 'FAILED';
    }
  }

  private deriveTicketState(
    session: TimerSession,
    previous: TicketRuntimeState | undefined,
    change: ChangeRuntime | undefined
  ): TicketRuntimeState {
    if (change) {
      switch (change.state) {
        case 'ARCHIVED':
          return 'ARCHIVED';
        case 'VALIDATED':
          return 'READY_FOR_ARCHIVE';
        case 'UNDER_REVIEW':
          return 'UNDER_REVIEW';
        case 'IN_IMPLEMENTATION':
          return 'IN_EXECUTION';
        case 'ARCHIVE_BLOCKED':
          return change.validation_status === 'BLOCKED' ? 'BLOCKED' : 'VALIDATION_FAILED';
        case 'TASKED':
          if (previous === 'PLANNED') {
            return 'PLANNED';
          }
          break;
        default:
          break;
      }
    }

    if (previous === 'ARCHIVED' || previous === 'BLOCKED') {
      return previous;
    }
    if (
      previous === 'SPEC_READY'
      || previous === 'PLANNED'
      || previous === 'IN_EXECUTION'
      || previous === 'UNDER_REVIEW'
      || previous === 'VALIDATION_FAILED'
      || previous === 'READY_FOR_ARCHIVE'
      || previous === 'DISCOVERY_IN_PROGRESS'
      || previous === 'ROOT_SPEC_REVIEW'
      || previous === 'HUMAN_ESCALATION_REQUIRED'
    ) {
      return previous;
    }
    if (session.openspec_change?.name) {
      return 'SPEC_READY';
    }
    if (session.jira_ticket) {
      return 'CONTEXT_IMPORTED';
    }
    return 'DISCOVERED';
  }

  private deriveChangeState(session: TimerSession, previous?: ChangeRuntimeState): ChangeRuntimeState {
    if (previous === 'ARCHIVED' || previous === 'ARCHIVE_BLOCKED') {
      return previous;
    }
    if (previous === 'IN_IMPLEMENTATION' || previous === 'UNDER_REVIEW' || previous === 'VALIDATED') {
      return previous;
    }
    if (!session.openspec_change) {
      return 'NOT_CREATED';
    }
    return 'TASKED';
  }

  private deriveValidationStatus(state: ChangeRuntimeState, previous?: ValidationStatus): ValidationStatus {
    if (state === 'ARCHIVED') {
      return 'PASSED';
    }
    if (state === 'ARCHIVE_BLOCKED') {
      return 'BLOCKED';
    }
    return previous ?? 'PENDING';
  }

  private deriveAutonomyLevel(session: TimerSession): AutonomyLevel {
    const currentMode = session.current_block?.actor_mode;
    if (currentMode === 'ai_autonomous') {
      return 'L2_ASSISTED';
    }
    return 'L2_ASSISTED';
  }

  private resolveActiveActivity(session: TimerSession): { activeMode: RuntimeActivityMode; activeKind: RuntimeWorkKind } {
    const block = this.findMostRelevantBlock(session);
    return {
      activeMode: block?.actor_mode ?? 'none',
      activeKind: block?.work_kind ?? 'none',
    };
  }

  private findMostRelevantBlock(session: TimerSession): TimerBlock | undefined {
    if (session.current_block) {
      return session.current_block;
    }
    const blocks = session.blocks ?? [];
    return blocks[blocks.length - 1];
  }

  private toRuntimeRelativePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
  }
}
