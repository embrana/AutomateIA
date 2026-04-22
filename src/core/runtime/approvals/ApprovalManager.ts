import { randomUUID } from 'crypto';
import { ArtifactManager } from '../artifacts/ArtifactManager.js';
import { RuntimeStore } from '../../../storage/fs/RuntimeStore.js';
import { StateEngine } from '../state/StateEngine.js';
import {
  RUNTIME_LAYOUT_VERSION,
  type ApprovalRequest,
  type ApprovalScope,
  type ApprovalStatus,
  type ChangeRuntime,
  type SessionRuntime,
  type TicketRuntime,
} from '../types.js';

function nowIso(): string {
  return new Date().toISOString();
}

export interface EnsureApprovalInput {
  ticketKey: string;
  sessionId: string;
  changeName?: string;
  scope: ApprovalScope;
  reason: string;
  evidenceRefs: string[];
}

export interface ArchiveGovernanceDecision {
  governed: boolean;
  allowed: boolean;
  worklogAllowed: boolean;
  reason?: string;
  ticketKey?: string;
  approvalIds?: string[];
}

interface RuntimeContextForChange {
  ticket: TicketRuntime;
  session: SessionRuntime | null;
  change: ChangeRuntime;
}

export class ApprovalManager {
  private readonly artifactManager: ArtifactManager;

  constructor(
    private readonly runtimeStore = new RuntimeStore(),
    private readonly stateEngine = new StateEngine(),
    projectRoot = process.cwd()
  ) {
    this.artifactManager = new ArtifactManager(this.runtimeStore, projectRoot);
  }

  async ensureApproval(input: EnsureApprovalInput): Promise<ApprovalRequest> {
    const existing = (await this.runtimeStore.listApprovalRequests(input.ticketKey))
      .find((approval) =>
        approval.status === 'PENDING'
        && approval.scope === input.scope
        && approval.change_name === input.changeName
      );
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    const approval: ApprovalRequest = {
      runtime_version: RUNTIME_LAYOUT_VERSION,
      created_at: timestamp,
      updated_at: timestamp,
      approval_id: `approval-${randomUUID()}`,
      ticket_key: input.ticketKey,
      session_id: input.sessionId,
      change_name: input.changeName,
      scope: input.scope,
      reason: input.reason,
      evidence_refs: input.evidenceRefs,
      status: 'PENDING',
      resolved_at: null,
    };
    await this.runtimeStore.saveApprovalRequest(approval);
    return approval;
  }

  async listApprovalsForTicket(ticketKey: string): Promise<ApprovalRequest[]> {
    return this.runtimeStore.listApprovalRequests(ticketKey);
  }

  async listPendingApprovals(ticketKey: string, changeName?: string, scope?: ApprovalScope): Promise<ApprovalRequest[]> {
    const approvals = await this.runtimeStore.listApprovalRequests(ticketKey);
    return approvals.filter((approval) =>
      approval.status === 'PENDING'
      && (changeName ? approval.change_name === changeName : true)
      && (scope ? approval.scope === scope : true)
    );
  }

  async findApprovalById(approvalId: string): Promise<ApprovalRequest | null> {
    const ticketKeys = await this.runtimeStore.listTicketKeys();
    for (const ticketKey of ticketKeys) {
      const approval = await this.runtimeStore.getApprovalRequest(ticketKey, approvalId);
      if (approval) {
        return approval;
      }
    }
    return null;
  }

  async resolveApproval(
    approvalId: string,
    status: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED'>,
    resolutionReason?: string
  ): Promise<ApprovalRequest> {
    const approval = await this.findApprovalById(approvalId);
    if (!approval) {
      throw new Error(`Approval '${approvalId}' not found.`);
    }
    if (approval.status !== 'PENDING') {
      throw new Error(`Approval '${approvalId}' is already ${approval.status.toLowerCase()}.`);
    }

    const updatedAt = nowIso();
    const resolved: ApprovalRequest = {
      ...approval,
      updated_at: updatedAt,
      status,
      resolved_at: updatedAt,
      resolution_reason: resolutionReason,
    };
    await this.runtimeStore.saveApprovalRequest(resolved);
    await this.applyApprovalResolution(resolved);
    return resolved;
  }

  async evaluateArchiveGovernance(changeName: string): Promise<ArchiveGovernanceDecision> {
    const runtimeContext = await this.findRuntimeContextForChange(changeName);
    if (!runtimeContext) {
      return {
        governed: false,
        allowed: true,
        worklogAllowed: true,
      };
    }

    const pendingArchiveApprovals = await this.listPendingApprovals(runtimeContext.ticket.ticket_key, changeName, 'archive');
    if (pendingArchiveApprovals.length > 0) {
      return {
        governed: true,
        allowed: false,
        worklogAllowed: runtimeContext.change.worklog_eligible ?? true,
        ticketKey: runtimeContext.ticket.ticket_key,
        approvalIds: pendingArchiveApprovals.map((approval) => approval.approval_id),
        reason: `Archive requires approval before closeout: ${pendingArchiveApprovals.map((approval) => approval.approval_id).join(', ')}`,
      };
    }

    const archiveDecision = await this.artifactManager.readJsonRef<{
      archive_ready: boolean;
      archive_allowed: boolean;
      worklog_allowed: boolean;
      blocking_reasons: string[];
    }>(this.artifactManager.getArchiveDecisionRef(runtimeContext.ticket.ticket_key, changeName));

    if (!archiveDecision) {
      return {
        governed: true,
        allowed: false,
        worklogAllowed: runtimeContext.change.worklog_eligible ?? true,
        ticketKey: runtimeContext.ticket.ticket_key,
        reason: 'Runtime archive decision is missing. Run `osj agent run delivery` or `osj orchestrate --until delivery` first.',
      };
    }

    if (runtimeContext.change.archive_eligible || archiveDecision.archive_allowed) {
      return {
        governed: true,
        allowed: true,
        worklogAllowed: runtimeContext.change.worklog_eligible ?? archiveDecision.worklog_allowed,
        ticketKey: runtimeContext.ticket.ticket_key,
      };
    }

    return {
      governed: true,
      allowed: false,
      worklogAllowed: runtimeContext.change.worklog_eligible ?? archiveDecision.worklog_allowed,
      ticketKey: runtimeContext.ticket.ticket_key,
      reason: archiveDecision.blocking_reasons[0] ?? 'Archive is blocked by the current runtime delivery decision.',
    };
  }

  private async applyApprovalResolution(approval: ApprovalRequest): Promise<void> {
    const ticket = await this.runtimeStore.getTicketRuntime(approval.ticket_key);
    const session = await this.runtimeStore.getSessionRuntime(approval.ticket_key);
    const change = approval.change_name
      ? await this.runtimeStore.getChangeRuntime(approval.ticket_key, approval.change_name)
      : null;

    if (!ticket || !session) {
      return;
    }

    if (this.shouldIgnoreStateMutationForStaleApproval(approval, ticket, change)) {
      return;
    }

    const updatedAt = nowIso();
    const nextSession = this.resolveSessionAfterApproval(session, approval, updatedAt);
    const nextTicket = this.resolveTicketAfterApproval(ticket, approval, updatedAt);
    const nextChange = change ? this.resolveChangeAfterApproval(change, approval, updatedAt) : null;

    this.stateEngine.assertSessionTransition(session.state, nextSession.state);
    this.stateEngine.assertTicketTransition(ticket.state, nextTicket.state);
    if (change && nextChange) {
      this.stateEngine.assertChangeTransition(change.state, nextChange.state);
    }

    await this.runtimeStore.saveSessionRuntime(nextSession);
    await this.runtimeStore.saveTicketRuntime(nextTicket);
    if (nextChange) {
      await this.runtimeStore.saveChangeRuntime(nextChange);
      await this.updateArchiveDecisionArtifact(nextChange, approval);
    }
  }

  private shouldIgnoreStateMutationForStaleApproval(
    approval: ApprovalRequest,
    ticket: TicketRuntime,
    change: ChangeRuntime | null
  ): boolean {
    if (approval.scope === 'archive') {
      return false;
    }

    if (ticket.state === 'READY_FOR_ARCHIVE' || ticket.state === 'ARCHIVED') {
      return true;
    }

    if (!change) {
      return false;
    }

    return change.state === 'VALIDATED' || change.state === 'ARCHIVED';
  }

  private resolveSessionAfterApproval(
    session: SessionRuntime,
    approval: ApprovalRequest,
    updatedAt: string
  ): SessionRuntime {
    const nextState = approval.status === 'APPROVED'
      ? 'ACTIVE'
      : approval.scope === 'archive'
        ? 'ACTIVE'
        : 'AWAITING_HUMAN';
    return {
      ...session,
      updated_at: updatedAt,
      state: nextState,
    };
  }

  private resolveTicketAfterApproval(
    ticket: TicketRuntime,
    approval: ApprovalRequest,
    updatedAt: string
  ): TicketRuntime {
    let nextState = ticket.state;

    if (approval.status === 'APPROVED') {
      if (approval.scope === 'archive') {
        nextState = 'READY_FOR_ARCHIVE';
      } else if (approval.scope === 'plan') {
        nextState = 'PLANNED';
      } else {
        nextState = 'IN_EXECUTION';
      }
    } else if (approval.scope === 'archive') {
      nextState = 'BLOCKED';
    } else {
      nextState = 'HUMAN_ESCALATION_REQUIRED';
    }

    return {
      ...ticket,
      updated_at: updatedAt,
      state: nextState,
    };
  }

  private resolveChangeAfterApproval(
    change: ChangeRuntime,
    approval: ApprovalRequest,
    updatedAt: string
  ): ChangeRuntime {
    let nextState = change.state;
    let validationStatus = change.validation_status;
    let archiveEligible = change.archive_eligible;

    if (approval.status === 'APPROVED') {
      if (approval.scope === 'archive') {
        nextState = 'VALIDATED';
        validationStatus = 'PASSED';
        archiveEligible = true;
      } else {
        nextState = 'IN_IMPLEMENTATION';
        validationStatus = change.validation_status === 'BLOCKED' ? 'FAILED' : change.validation_status;
        archiveEligible = false;
      }
    } else {
      nextState = approval.scope === 'archive' ? 'ARCHIVE_BLOCKED' : 'UNDER_REVIEW';
      validationStatus = approval.scope === 'archive' ? 'BLOCKED' : change.validation_status;
      archiveEligible = false;
    }

    return {
      ...change,
      updated_at: updatedAt,
      state: nextState,
      validation_status: validationStatus,
      archive_eligible: archiveEligible,
      worklog_eligible: change.worklog_eligible ?? true,
      last_archive_reason: approval.resolution_reason ?? change.last_archive_reason,
    };
  }

  private async updateArchiveDecisionArtifact(change: ChangeRuntime, approval: ApprovalRequest): Promise<void> {
    const currentDecision = await this.artifactManager.readJsonRef<Record<string, unknown>>(
      this.artifactManager.getArchiveDecisionRef(change.ticket_key, change.change_name)
    );
    if (!currentDecision) {
      return;
    }

    const nextDecision = {
      ...currentDecision,
      archive_allowed: approval.status === 'APPROVED',
      approval_required: false,
      blocking_reasons: approval.status === 'APPROVED'
        ? []
        : [approval.resolution_reason ?? 'Archive approval was rejected.'],
      approval_id: approval.approval_id,
      approval_status: approval.status,
    };
    await this.artifactManager.writeChangeJson(change.ticket_key, change.change_name, 'delivery', 'archive-decision.json', nextDecision);
  }

  private async findRuntimeContextForChange(changeName: string): Promise<RuntimeContextForChange | null> {
    const ticketKeys = await this.runtimeStore.listTicketKeys();
    for (const ticketKey of ticketKeys) {
      const ticket = await this.runtimeStore.getTicketRuntime(ticketKey);
      const session = await this.runtimeStore.getSessionRuntime(ticketKey);
      const change = await this.runtimeStore.getChangeRuntime(ticketKey, changeName);
      if (ticket && change) {
        return { ticket, session, change };
      }
    }
    return null;
  }
}
