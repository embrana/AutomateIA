import { RuntimeStore } from '../../storage/fs/RuntimeStore.js';
import { SessionManager } from './session/SessionManager.js';
import { ApprovalManager } from './approvals/ApprovalManager.js';
import type { AgentRun, RuntimeActivityMode, RuntimeSnapshot, RuntimeWorkKind } from './types.js';

export interface RuntimeStatusOptions {
  json?: boolean;
}

export class RuntimeStatusCommand {
  constructor(
    private readonly sessionManager = new SessionManager(),
    private readonly runtimeStore = new RuntimeStore(),
    private readonly approvalManager = new ApprovalManager()
  ) {}

  async execute(options: RuntimeStatusOptions = {}): Promise<void> {
    const snapshot = await this.sessionManager.getCurrentRuntimeSnapshot();
    if (!snapshot) {
      console.log('No OpenSpec runtime state found.');
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    const displayedActivity = await this.resolveDisplayedActivity(snapshot);

    console.log(`OpenSpec runtime source: ${snapshot.source}`);
    console.log(`Ticket: ${snapshot.ticket.ticket_key}`);
    if (snapshot.ticket.summary) {
      console.log(`Summary: ${snapshot.ticket.summary}`);
    }
    console.log(`Ticket state: ${snapshot.ticket.state}`);
    console.log(`Session state: ${snapshot.session.state}`);
    console.log(`Session ID: ${snapshot.session.session_id}`);
    console.log(`Autonomy: ${snapshot.session.autonomy_level}`);
    console.log(`Activity: ${displayedActivity.mode} / ${displayedActivity.kind}`);
    if (displayedActivity.agentName) {
      console.log(`${displayedActivity.agentLabel ?? 'Running agent'}: ${displayedActivity.agentName}`);
    }
    if (
      displayedActivity.mode !== snapshot.session.active_mode
      || displayedActivity.kind !== snapshot.session.active_kind
    ) {
      console.log(`Timer block: ${snapshot.session.active_mode} / ${snapshot.session.active_kind}`);
    }
    console.log(`Current cycle: ${snapshot.session.current_cycle}`);
    if (snapshot.change) {
      console.log(`Change: ${snapshot.change.change_name}`);
      console.log(`Change state: ${snapshot.change.state}`);
      console.log(`Validation status: ${snapshot.change.validation_status}`);
      console.log(`Archive eligible: ${snapshot.change.archive_eligible ? 'yes' : 'no'}`);
      if (snapshot.change.worklog_eligible !== undefined) {
        console.log(`Worklog eligible: ${snapshot.change.worklog_eligible ? 'yes' : 'no'}`);
      }
      if (snapshot.session.current_cycle > 0) {
        const cycleId = `cycle-${String(snapshot.session.current_cycle).padStart(3, '0')}`;
        const cycle = await this.runtimeStore.getExecutionCycle(
          snapshot.ticket.ticket_key,
          snapshot.change.change_name,
          cycleId
        );
        if (cycle) {
          console.log(`Cycle state: ${cycle.state}`);
          console.log(`Cycle ID: ${cycle.cycle_id}`);
        }
      }
    }
    const approvals = await this.approvalManager.listPendingApprovals(
      snapshot.ticket.ticket_key,
      snapshot.change?.change_name
    );
    if (approvals.length > 0) {
      console.log(`Pending approvals: ${approvals.map((approval) => approval.approval_id).join(', ')}`);
    }
    if (snapshot.session.sync_error) {
      console.log(`Sync error: ${snapshot.session.sync_error}`);
    }
    console.log(`Runtime root: ${this.runtimeStore.getTicketDir(snapshot.ticket.ticket_key)}`);
    console.log(`Updated: ${snapshot.session.updated_at}`);
  }

  private async resolveDisplayedActivity(snapshot: RuntimeSnapshot): Promise<{
    mode: RuntimeActivityMode;
    kind: RuntimeWorkKind;
    agentName?: string;
    agentLabel?: string;
  }> {
    const fallback = {
      mode: snapshot.session.active_mode,
      kind: snapshot.session.active_kind,
    } satisfies { mode: RuntimeActivityMode; kind: RuntimeWorkKind };

    if (!snapshot.change || snapshot.session.current_cycle <= 0) {
      return fallback;
    }

    const cycleId = `cycle-${String(snapshot.session.current_cycle).padStart(3, '0')}`;
    const cycle = await this.runtimeStore.getExecutionCycle(
      snapshot.ticket.ticket_key,
      snapshot.change.change_name,
      cycleId
    );

    if (!cycle) {
      return fallback;
    }

    const runs = await this.runtimeStore.listAgentRuns(
      snapshot.ticket.ticket_key,
      snapshot.change.change_name
    );
    const currentCycleRuns = runs.filter((run) => run.cycle_id === cycleId);
    const runningRun = [...currentCycleRuns]
      .reverse()
      .find((run) => run.status === 'RUNNING');

    if (runningRun) {
      return {
        mode: 'ai_autonomous',
        kind: this.mapAgentToWorkKind(runningRun.agent_name),
        agentName: runningRun.agent_name,
        agentLabel: 'Running agent',
      };
    }

    if (cycle.state === 'RUNNING') {
      return {
        mode: 'ai_autonomous',
        kind: 'implementation',
      };
    }

    if (cycle.state === 'UNDER_REVIEW') {
      return {
        mode: 'ai_autonomous',
        kind: 'review',
        agentName: this.findMostRelevantCompletedAgent(currentCycleRuns, ['critic_agent', 'implementation_agent']),
        agentLabel: 'Last agent',
      };
    }

    if (cycle.state === 'VALIDATING') {
      return {
        mode: 'ai_autonomous',
        kind: 'testing',
        agentName: this.findMostRelevantCompletedAgent(currentCycleRuns, ['validation_agent']),
        agentLabel: 'Last agent',
      };
    }

    return fallback;
  }

  private mapAgentToWorkKind(agentName: AgentRun['agent_name']): RuntimeWorkKind {
    switch (agentName) {
      case 'context_agent':
      case 'spec_agent':
      case 'planning_agent':
        return 'spec';
      case 'implementation_agent':
        return 'implementation';
      case 'critic_agent':
        return 'review';
      case 'validation_agent':
        return 'testing';
      case 'delivery_agent':
        return 'review';
      default:
        return 'other';
    }
  }

  private findMostRelevantCompletedAgent(runs: AgentRun[], preferredAgents: string[]): string | undefined {
    const preferred = [...runs]
      .reverse()
      .find((run) => preferredAgents.includes(run.agent_name) && run.status === 'SUCCEEDED');
    return preferred?.agent_name;
  }
}
