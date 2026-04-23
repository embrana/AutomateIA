import { RuntimeStore } from '../../storage/fs/RuntimeStore.js';
import { ApprovalManager } from './approvals/ApprovalManager.js';
import { ArtifactManager } from './artifacts/ArtifactManager.js';
import { SessionManager } from './session/SessionManager.js';
import type {
  ApprovalRequest,
  ChangeRuntime,
  ExecutionCycle,
  RuntimeSnapshot,
} from './types.js';

export interface RuntimeExplainOptions {
  json?: boolean;
}

export interface RuntimeExplainSnapshotSummary {
  ticket: string;
  summary?: string;
  ticket_state: RuntimeSnapshot['ticket']['state'];
  session_id: string;
  session_state: RuntimeSnapshot['session']['state'];
  change: string | null;
  change_state: ChangeRuntime['state'] | null;
  validation_status: ChangeRuntime['validation_status'] | null;
  archive_eligible: boolean | null;
  worklog_eligible: boolean | null;
  current_cycle: {
    id: string;
    state: ExecutionCycle['state'];
    iteration: number;
  } | null;
  updated_at: string;
}

export interface RuntimeExplainBlocker {
  kind: 'approval' | 'validation' | 'archive' | 'cycle' | 'sync';
  title: string;
  reason: string;
  state?: string;
  approval_id?: string;
  artifact_ref?: string | null;
}

export interface RuntimeExplainPendingApproval {
  approval_id: string;
  scope: ApprovalRequest['scope'];
  change_name?: string;
  reason: string;
  evidence_refs: string[];
  suggested_commands: {
    show: string;
    accept: string;
    reject: string;
  };
}

export interface RuntimeExplainSuggestedAction {
  route: 'approval' | 'implementation' | 'validation' | 'delivery' | 'archive' | 'recovery' | 'observe';
  summary: string;
  command: string | null;
}

export interface RuntimeExplainResult {
  found: boolean;
  message: string;
  source: RuntimeSnapshot['source'] | null;
  runtime_root: string | null;
  snapshot: RuntimeExplainSnapshotSummary | null;
  explanation: {
    summary: string;
    primary_reason: string | null;
  } | null;
  blockers: RuntimeExplainBlocker[];
  pending_approvals: RuntimeExplainPendingApproval[];
  suggested_next_action: RuntimeExplainSuggestedAction | null;
  primary_evidence_ref: string | null;
  artifact_refs: string[];
}

interface ValidationResultArtifact {
  validation_result: 'PASSED' | 'FAILED';
  failure_classification:
    | 'PASSED'
    | 'RETRYABLE_IMPLEMENTATION_ERROR'
    | 'SPEC_AMBIGUITY'
    | 'ENVIRONMENT_FAILURE'
    | 'REQUIRES_HUMAN_DECISION'
    | 'NON_RECOVERABLE';
  reasons: string[];
}

interface ArchiveDecisionArtifact {
  archive_ready: boolean;
  archive_allowed: boolean;
  worklog_allowed: boolean;
  approval_required: boolean;
  approval_id?: string;
  approval_status?: string;
  blocking_reasons: string[];
  jira_comment?: string;
}

interface ArtifactContext {
  planning_ref: string | null;
  implementation_ref: string | null;
  critic_ref: string | null;
  validation_ref: string | null;
  closure_ref: string | null;
  archive_decision_ref: string | null;
  validation_result: ValidationResultArtifact | null;
  archive_decision: ArchiveDecisionArtifact | null;
}

function uniqueRefs(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    refs.push(value);
  }
  return refs;
}

export class RuntimeExplainCommand {
  constructor(
    private readonly sessionManager = new SessionManager(),
    private readonly runtimeStore = new RuntimeStore(),
    private readonly approvalManager = new ApprovalManager(),
    private readonly artifactManager = new ArtifactManager()
  ) {}

  async explain(): Promise<RuntimeExplainResult> {
    const snapshot = await this.sessionManager.getCurrentRuntimeSnapshot();
    if (!snapshot) {
      return {
        found: false,
        message: 'No OpenSpec runtime state found. Start a session with `osj purpose` or create runtime artifacts first.',
        source: null,
        runtime_root: null,
        snapshot: null,
        explanation: null,
        blockers: [],
        pending_approvals: [],
        suggested_next_action: null,
        primary_evidence_ref: null,
        artifact_refs: [],
      };
    }

    const cycle = await this.loadCurrentCycle(snapshot);
    const pendingApprovals = await this.loadPendingApprovals(snapshot);
    const artifacts = await this.loadArtifacts(snapshot);
    const blockers = this.buildBlockers(snapshot, cycle, pendingApprovals, artifacts);
    const suggestedNextAction = this.buildSuggestedNextAction(snapshot, cycle, pendingApprovals, artifacts);
    const artifactRefs = this.buildArtifactRefs(pendingApprovals, artifacts);
    const primaryReason = blockers[0]?.reason ?? this.buildHealthyReason(snapshot, cycle, artifacts);

    return {
      found: true,
      message: `OpenSpec runtime explanation for ${snapshot.ticket.ticket_key}`,
      source: snapshot.source,
      runtime_root: snapshot.runtime_root,
      snapshot: {
        ticket: snapshot.ticket.ticket_key,
        summary: snapshot.ticket.summary,
        ticket_state: snapshot.ticket.state,
        session_id: snapshot.session.session_id,
        session_state: snapshot.session.state,
        change: snapshot.change?.change_name ?? null,
        change_state: snapshot.change?.state ?? null,
        validation_status: snapshot.change?.validation_status ?? null,
        archive_eligible: snapshot.change?.archive_eligible ?? null,
        worklog_eligible: snapshot.change?.worklog_eligible ?? null,
        current_cycle: cycle
          ? {
              id: cycle.cycle_id,
              state: cycle.state,
              iteration: cycle.iteration_no,
            }
          : null,
        updated_at: snapshot.session.updated_at,
      },
      explanation: {
        summary: blockers.length > 0
          ? `Ticket ${snapshot.ticket.ticket_key} is ${snapshot.ticket.state}. ${primaryReason}`
          : `Ticket ${snapshot.ticket.ticket_key} is ${snapshot.ticket.state}. ${suggestedNextAction.summary}`,
        primary_reason: primaryReason,
      },
      blockers,
      pending_approvals: pendingApprovals.map((approval) => this.toExplainApproval(approval)),
      suggested_next_action: suggestedNextAction,
      primary_evidence_ref: artifactRefs[0] ?? null,
      artifact_refs: artifactRefs,
    };
  }

  async execute(options: RuntimeExplainOptions = {}): Promise<void> {
    const explanation = await this.explain();

    if (options.json) {
      console.log(JSON.stringify(explanation, null, 2));
      return;
    }

    if (!explanation.found || !explanation.snapshot || !explanation.explanation || !explanation.suggested_next_action) {
      console.log(explanation.message);
      return;
    }

    console.log(`OpenSpec runtime source: ${explanation.source}`);
    console.log(`Ticket: ${explanation.snapshot.ticket}`);
    if (explanation.snapshot.summary) {
      console.log(`Summary: ${explanation.snapshot.summary}`);
    }
    console.log(`Ticket state: ${explanation.snapshot.ticket_state}`);
    console.log(`Session state: ${explanation.snapshot.session_state}`);
    console.log(`Session ID: ${explanation.snapshot.session_id}`);
    if (explanation.snapshot.change) {
      console.log(`Change: ${explanation.snapshot.change}`);
      console.log(`Change state: ${explanation.snapshot.change_state}`);
      console.log(`Validation status: ${explanation.snapshot.validation_status}`);
      console.log(`Archive eligible: ${explanation.snapshot.archive_eligible ? 'yes' : 'no'}`);
      if (explanation.snapshot.worklog_eligible !== null) {
        console.log(`Worklog eligible: ${explanation.snapshot.worklog_eligible ? 'yes' : 'no'}`);
      }
    }
    if (explanation.snapshot.current_cycle) {
      console.log(`Current cycle: ${explanation.snapshot.current_cycle.id}`);
      console.log(`Cycle state: ${explanation.snapshot.current_cycle.state}`);
    }
    console.log(`Why: ${explanation.explanation.primary_reason ?? 'No blocking signal is active.'}`);
    console.log(`Next step: ${explanation.suggested_next_action.summary}`);
    if (explanation.suggested_next_action.command) {
      console.log(`Suggested command: ${explanation.suggested_next_action.command}`);
    }

    if (explanation.pending_approvals.length > 0) {
      console.log('Pending approvals:');
      for (const approval of explanation.pending_approvals) {
        console.log(`- ${approval.approval_id} [${approval.scope}]: ${approval.reason}`);
        console.log(`  show: ${approval.suggested_commands.show}`);
        console.log(`  accept: ${approval.suggested_commands.accept}`);
        console.log(`  reject: ${approval.suggested_commands.reject}`);
      }
    }

    if (explanation.primary_evidence_ref) {
      console.log(`Primary evidence: ${explanation.primary_evidence_ref}`);
    }
    if (explanation.artifact_refs.length > 0) {
      console.log('Relevant artifacts:');
      for (const ref of explanation.artifact_refs) {
        console.log(`- ${ref}`);
      }
    }
    console.log(`Runtime root: ${explanation.runtime_root}`);
    console.log(`Updated: ${explanation.snapshot.updated_at}`);
  }

  private async loadCurrentCycle(snapshot: RuntimeSnapshot): Promise<ExecutionCycle | null> {
    if (!snapshot.change || snapshot.session.current_cycle <= 0) {
      return null;
    }

    const cycleId = `cycle-${String(snapshot.session.current_cycle).padStart(3, '0')}`;
    return this.runtimeStore.getExecutionCycle(
      snapshot.ticket.ticket_key,
      snapshot.change.change_name,
      cycleId
    );
  }

  private async loadPendingApprovals(snapshot: RuntimeSnapshot): Promise<ApprovalRequest[]> {
    const approvals = await this.approvalManager.listPendingApprovals(snapshot.ticket.ticket_key);
    const activeChange = snapshot.change?.change_name;
    return approvals.sort((left, right) => {
      const leftScore = left.change_name === activeChange ? 0 : 1;
      const rightScore = right.change_name === activeChange ? 0 : 1;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.created_at.localeCompare(right.created_at);
    });
  }

  private async loadArtifacts(snapshot: RuntimeSnapshot): Promise<ArtifactContext> {
    if (!snapshot.change) {
      return {
        planning_ref: null,
        implementation_ref: null,
        critic_ref: null,
        validation_ref: null,
        closure_ref: null,
        archive_decision_ref: null,
        validation_result: null,
        archive_decision: null,
      };
    }

    const { ticket_key: ticketKey } = snapshot.ticket;
    const { change_name: changeName } = snapshot.change;
    const planningRef = this.artifactManager.getPlanningRef(ticketKey, changeName);
    const implementationRef = this.artifactManager.getImplementationRef(ticketKey, changeName);
    const criticRef = this.artifactManager.getCriticRef(ticketKey, changeName);
    const validationRef = this.artifactManager.getValidationRef(ticketKey, changeName);
    const closureRef = this.artifactManager.getDeliveryClosureRef(ticketKey, changeName);
    const archiveDecisionRef = this.artifactManager.getArchiveDecisionRef(ticketKey, changeName);

    const [
      planningExists,
      implementationExists,
      criticExists,
      closureExists,
      validationResult,
      archiveDecision,
    ] = await Promise.all([
      this.artifactManager.fileExists(planningRef),
      this.artifactManager.fileExists(implementationRef),
      this.artifactManager.fileExists(criticRef),
      this.artifactManager.fileExists(closureRef),
      this.artifactManager.readJsonRef<ValidationResultArtifact>(validationRef),
      this.artifactManager.readJsonRef<ArchiveDecisionArtifact>(archiveDecisionRef),
    ]);

    return {
      planning_ref: planningExists ? planningRef : null,
      implementation_ref: implementationExists ? implementationRef : null,
      critic_ref: criticExists ? criticRef : null,
      validation_ref: validationResult ? validationRef : null,
      closure_ref: closureExists ? closureRef : null,
      archive_decision_ref: archiveDecision ? archiveDecisionRef : null,
      validation_result: validationResult,
      archive_decision: archiveDecision,
    };
  }

  private buildBlockers(
    snapshot: RuntimeSnapshot,
    cycle: ExecutionCycle | null,
    pendingApprovals: ApprovalRequest[],
    artifacts: ArtifactContext
  ): RuntimeExplainBlocker[] {
    const blockers: RuntimeExplainBlocker[] = pendingApprovals.map((approval) => ({
      kind: 'approval',
      title: `${approval.scope} approval pending`,
      reason: approval.reason,
      state: approval.status,
      approval_id: approval.approval_id,
      artifact_ref: approval.evidence_refs[0] ?? null,
    }));

    if (snapshot.session.sync_error) {
      blockers.push({
        kind: 'sync',
        title: 'Runtime sync error',
        reason: snapshot.session.sync_error,
        state: snapshot.session.state,
      });
    }

    const validationReason = this.describeValidationReason(artifacts.validation_result);
    if (
      validationReason
      && (
        snapshot.ticket.state === 'VALIDATION_FAILED'
        || snapshot.ticket.state === 'BLOCKED'
        || snapshot.ticket.state === 'HUMAN_ESCALATION_REQUIRED'
        || snapshot.change?.validation_status === 'FAILED'
        || snapshot.change?.validation_status === 'BLOCKED'
        || cycle?.state === 'FAILED_RETRYABLE'
        || cycle?.state === 'FAILED_ESCALATED'
      )
    ) {
      blockers.push({
        kind: 'validation',
        title: this.describeValidationTitle(snapshot, artifacts.validation_result),
        reason: validationReason,
        state: artifacts.validation_result?.failure_classification ?? snapshot.change?.validation_status ?? undefined,
        artifact_ref: artifacts.validation_ref,
      });
    }

    const archiveReason = this.describeArchiveReason(snapshot, artifacts.archive_decision, pendingApprovals);
    if (archiveReason) {
      blockers.push({
        kind: 'archive',
        title: 'Archive is blocked',
        reason: archiveReason,
        state: snapshot.change?.state ?? snapshot.ticket.state,
        artifact_ref: artifacts.archive_decision_ref ?? artifacts.closure_ref,
      });
    }

    if (cycle?.state === 'FAILED_RETRYABLE' || cycle?.state === 'FAILED_ESCALATED') {
      blockers.push({
        kind: 'cycle',
        title: 'Current cycle failed',
        reason: cycle.state === 'FAILED_RETRYABLE'
          ? 'The current cycle failed in a retryable state.'
          : 'The current cycle failed and needs human intervention.',
        state: cycle.state,
        artifact_ref: artifacts.validation_ref ?? artifacts.critic_ref ?? artifacts.implementation_ref,
      });
    }

    return uniqueRefs(blockers.map((blocker) => `${blocker.kind}:${blocker.title}:${blocker.reason}`))
      .map((key) => blockers.find((blocker) => `${blocker.kind}:${blocker.title}:${blocker.reason}` === key)!)
      .sort((left, right) => this.rankBlocker(left) - this.rankBlocker(right));
  }

  private buildSuggestedNextAction(
    snapshot: RuntimeSnapshot,
    cycle: ExecutionCycle | null,
    pendingApprovals: ApprovalRequest[],
    artifacts: ArtifactContext
  ): RuntimeExplainSuggestedAction {
    const firstPendingApproval = pendingApprovals[0];
    if (firstPendingApproval) {
      return {
        route: 'approval',
        summary: `Resolve approval ${firstPendingApproval.approval_id} before continuing the runtime.`,
        command: 'osj approval show',
      };
    }

    if (snapshot.session.sync_error) {
      return {
        route: 'recovery',
        summary: 'Fix the runtime sync error before continuing.',
        command: null,
      };
    }

    if (snapshot.ticket.state === 'READY_FOR_ARCHIVE' && (snapshot.change?.archive_eligible || artifacts.archive_decision?.archive_allowed)) {
      return {
        route: 'archive',
        summary: 'Archive the validated change and close out the runtime.',
        command: 'osj archive',
      };
    }

    if (snapshot.ticket.state === 'VALIDATION_FAILED' || cycle?.state === 'FAILED_RETRYABLE') {
      return {
        route: 'implementation',
        summary: 'Return to implementation, address the validation findings, and rerun the cycle.',
        command: 'osj orchestrate --until implementation',
      };
    }

    if (snapshot.ticket.state === 'BLOCKED') {
      if (artifacts.validation_result?.failure_classification === 'ENVIRONMENT_FAILURE') {
        return {
          route: 'validation',
          summary: 'Fix the environment issue and rerun validation.',
          command: 'osj orchestrate --until validation',
        };
      }

      if (snapshot.change?.state === 'ARCHIVE_BLOCKED' || artifacts.archive_decision) {
        return {
          route: 'delivery',
          summary: 'Resolve the delivery blocker and refresh the archive decision.',
          command: 'osj orchestrate --until delivery',
        };
      }

      return {
        route: 'recovery',
        summary: 'Manual recovery is required before the runtime can continue.',
        command: null,
      };
    }

    if (
      snapshot.ticket.state === 'HUMAN_ESCALATION_REQUIRED'
      || snapshot.session.state === 'AWAITING_HUMAN'
      || cycle?.state === 'FAILED_ESCALATED'
    ) {
      return {
        route: 'approval',
        summary: 'A human decision is required before the runtime can continue.',
        command: 'osj runtime explain',
      };
    }

    if (cycle?.state === 'VALIDATING') {
      return {
        route: 'validation',
        summary: 'Validation is already running. Recheck the runtime once the cycle completes.',
        command: 'osj orchestrate --until validation',
      };
    }

    if (snapshot.change?.state === 'UNDER_REVIEW' || cycle?.state === 'UNDER_REVIEW') {
      return {
        route: 'validation',
        summary: 'Continue from review into validation.',
        command: 'osj orchestrate --until validation',
      };
    }

    if (snapshot.change?.state === 'VALIDATED') {
      if (snapshot.change.archive_eligible || artifacts.archive_decision?.archive_allowed) {
        return {
          route: 'archive',
          summary: 'Archive the validated change and close out the runtime.',
          command: 'osj archive',
        };
      }
      return {
        route: 'delivery',
        summary: 'Generate or refresh delivery artifacts before archiving.',
        command: 'osj orchestrate --until delivery',
      };
    }

    if (
      snapshot.change?.state === 'IN_IMPLEMENTATION'
      || cycle?.state === 'RUNNING'
      || snapshot.ticket.state === 'IN_EXECUTION'
    ) {
      return {
        route: 'implementation',
        summary: cycle?.state === 'RUNNING'
          ? 'Implementation is already running. Rerun only if the cycle stalls.'
          : 'Continue implementation for the active change.',
        command: 'osj orchestrate --until implementation',
      };
    }

    if (
      snapshot.change?.state === 'TASKED'
      || snapshot.ticket.state === 'PLANNED'
      || snapshot.ticket.state === 'SPEC_READY'
    ) {
      return {
        route: 'implementation',
        summary: 'Start implementation for the planned change.',
        command: 'osj orchestrate --until implementation',
      };
    }

    return {
      route: 'observe',
      summary: 'No blocking signal is active. Recheck the runtime after the current work completes.',
      command: null,
    };
  }

  private buildArtifactRefs(pendingApprovals: ApprovalRequest[], artifacts: ArtifactContext): string[] {
    const approvalEvidenceRefs = pendingApprovals.flatMap((approval) => approval.evidence_refs);
    return uniqueRefs([
      ...approvalEvidenceRefs,
      artifacts.validation_ref,
      artifacts.archive_decision_ref,
      artifacts.closure_ref,
      artifacts.critic_ref,
      artifacts.implementation_ref,
      artifacts.planning_ref,
    ]);
  }

  private buildHealthyReason(
    snapshot: RuntimeSnapshot,
    cycle: ExecutionCycle | null,
    artifacts: ArtifactContext
  ): string | null {
    if (snapshot.ticket.state === 'READY_FOR_ARCHIVE' && (snapshot.change?.archive_eligible || artifacts.archive_decision?.archive_allowed)) {
      return 'Validation passed and archive is allowed under the current runtime policy.';
    }
    if (cycle?.state === 'VALIDATING') {
      return 'Validation is currently running and has not produced a blocking result yet.';
    }
    if (cycle?.state === 'UNDER_REVIEW' || snapshot.change?.state === 'UNDER_REVIEW') {
      return 'Implementation is under review and no blocking signal is active yet.';
    }
    if (cycle?.state === 'RUNNING' || snapshot.change?.state === 'IN_IMPLEMENTATION') {
      return 'Implementation is in progress and no blocking signal is active.';
    }
    return null;
  }

  private describeValidationReason(validationResult: ValidationResultArtifact | null): string | null {
    if (!validationResult || validationResult.failure_classification === 'PASSED') {
      return null;
    }

    const primaryReason = validationResult.reasons[0];
    switch (validationResult.failure_classification) {
      case 'SPEC_AMBIGUITY':
        return primaryReason ?? 'Validation stopped because ticket or spec ambiguities remain unresolved.';
      case 'REQUIRES_HUMAN_DECISION':
        return primaryReason ?? 'Validation requires a human decision before the runtime can continue.';
      case 'ENVIRONMENT_FAILURE':
        return primaryReason ?? 'Validation could not complete because the environment failed.';
      case 'NON_RECOVERABLE':
        return primaryReason ?? 'Validation reported a non-recoverable runtime issue.';
      case 'RETRYABLE_IMPLEMENTATION_ERROR':
        return primaryReason ?? 'Validation found retryable implementation issues.';
      default:
        return primaryReason ?? null;
    }
  }

  private describeValidationTitle(
    snapshot: RuntimeSnapshot,
    validationResult: ValidationResultArtifact | null
  ): string {
    if (snapshot.ticket.state === 'HUMAN_ESCALATION_REQUIRED' || validationResult?.failure_classification === 'REQUIRES_HUMAN_DECISION') {
      return 'Human decision required';
    }
    if (snapshot.ticket.state === 'BLOCKED') {
      return 'Runtime is blocked';
    }
    return 'Validation failed';
  }

  private describeArchiveReason(
    snapshot: RuntimeSnapshot,
    archiveDecision: ArchiveDecisionArtifact | null,
    pendingApprovals: ApprovalRequest[]
  ): string | null {
    if (pendingApprovals.some((approval) => approval.scope === 'archive')) {
      return null;
    }

    if (archiveDecision?.approval_required) {
      return archiveDecision.blocking_reasons[0] ?? 'Archive is waiting for human approval under the current runtime policy.';
    }

    if (snapshot.change?.state === 'ARCHIVE_BLOCKED' || snapshot.ticket.state === 'BLOCKED') {
      return archiveDecision?.blocking_reasons[0]
        ?? snapshot.change?.last_archive_reason
        ?? null;
    }

    return null;
  }

  private toExplainApproval(approval: ApprovalRequest): RuntimeExplainPendingApproval {
    return {
      approval_id: approval.approval_id,
      scope: approval.scope,
      change_name: approval.change_name,
      reason: approval.reason,
      evidence_refs: approval.evidence_refs,
      suggested_commands: {
        show: 'osj approval show',
        accept: `osj approval accept ${approval.approval_id} --reason "approved by developer"`,
        reject: `osj approval reject ${approval.approval_id} --reason "rejected by developer"`,
      },
    };
  }

  private rankBlocker(blocker: RuntimeExplainBlocker): number {
    switch (blocker.kind) {
      case 'approval':
        return 0;
      case 'validation':
        return 1;
      case 'archive':
        return 2;
      case 'sync':
        return 3;
      case 'cycle':
      default:
        return 4;
    }
  }
}
