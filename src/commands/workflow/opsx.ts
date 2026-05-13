import { getActiveSession } from '../../core/timer/store.js';
import type { ImportedJiraTicket, TimerActorMode, TimerSession, TimerWorkKind } from '../../core/timer/types.js';
import { switchRunningSessionBlock } from '../../core/timer/commands.js';
import { newChangeCommand } from './new-change.js';

export type OpsxWorkflow = 'explore' | 'propose';
export type OpsxWorkflowPhase = 'discovery' | 'generation' | 'review';

export interface OpsxTrackOptions {
  json?: boolean;
  phase?: OpsxWorkflowPhase;
}

export interface OpsxCreateChangeOptions {
  schema?: string;
}

export interface OpsxTrackResult {
  workflow: OpsxWorkflow;
  phase: OpsxWorkflowPhase;
  session: {
    found: boolean;
    jira_issue_key: string | null;
    status: TimerSession['status'] | null;
    change_name: string | null;
    tracking_applied: boolean;
    use_session_aware_change_creation: boolean;
    target_block: {
      mode: TimerActorMode;
      kind: TimerWorkKind;
      description: string;
    };
  };
  ticket: ImportedJiraTicket | null;
  message: string;
}

interface WorkflowTrackingDefinition {
  workflow: OpsxWorkflow;
  phase: OpsxWorkflowPhase;
  mode: TimerActorMode;
  kind: TimerWorkKind;
  description: string;
}

const OPSX_TRACKING: Record<string, WorkflowTrackingDefinition> = {
  'explore:discovery': {
    workflow: 'explore',
    phase: 'discovery',
    mode: 'human_agent_interaction',
    kind: 'spec',
    description: 'OPSX explore discovery and requirement clarification',
  },
  'propose:discovery': {
    workflow: 'propose',
    phase: 'discovery',
    mode: 'human_agent_interaction',
    kind: 'spec',
    description: 'OPSX propose discovery and artifact drafting',
  },
  'propose:generation': {
    workflow: 'propose',
    phase: 'generation',
    mode: 'ai_autonomous',
    kind: 'spec',
    description: 'OpenSpec generated planning artifacts',
  },
  'propose:review': {
    workflow: 'propose',
    phase: 'review',
    mode: 'human_agent_interaction',
    kind: 'spec',
    description: 'Review OpenSpec proposal artifacts with developer',
  },
};

function resolveOpsxTracking(workflow: OpsxWorkflow, phase?: OpsxWorkflowPhase): WorkflowTrackingDefinition {
  const normalizedPhase = workflow === 'explore' ? 'discovery' : (phase ?? 'discovery');
  const key = `${workflow}:${normalizedPhase}`;
  const definition = OPSX_TRACKING[key];
  if (!definition) {
    throw new Error(
      workflow === 'explore'
        ? "Unsupported OPSX explore phase. Use the default discovery phase."
        : "Unsupported OPSX propose phase. Use discovery, generation, or review."
    );
  }
  return definition;
}

function buildTrackMessage(
  definition: WorkflowTrackingDefinition,
  session: TimerSession | null,
  trackingApplied: boolean
): string {
  if (!session) {
    return `No active OpenSpec session found. Continue ${definition.workflow} with plain OpenSpec context.`;
  }

  if (trackingApplied) {
    return `Tracked OPSX ${definition.workflow} (${definition.phase}) on ${session.jira_issue_key} as ${definition.mode} / ${definition.kind}.`;
  }

  switch (session.status) {
    case 'paused':
      return `Active OpenSpec session for ${session.jira_issue_key} is paused. Resume it before OPSX tracking can switch blocks.`;
    case 'sync_pending':
      return `Active OpenSpec session for ${session.jira_issue_key} is pending Jira sync. Recover or discard it before tracking more OPSX work.`;
    case 'closed':
      return `Active OpenSpec session for ${session.jira_issue_key} is closed. Start a new session before OPSX tracking can switch blocks.`;
    default:
      return `OPSX ${definition.workflow} tracking did not change the timer block.`;
  }
}

export async function trackOpsxWorkflow(
  workflow: OpsxWorkflow,
  options: OpsxTrackOptions = {}
): Promise<OpsxTrackResult> {
  const definition = resolveOpsxTracking(workflow, options.phase);
  const session = await getActiveSession();

  let trackingApplied = false;
  if (session?.status === 'running') {
    trackingApplied = Boolean(await switchRunningSessionBlock({
      mode: definition.mode,
      kind: definition.kind,
      description: definition.description,
      source: 'auto',
    }));
  }

  const latestSession = trackingApplied
    ? await getActiveSession()
    : session;

  const result: OpsxTrackResult = {
    workflow: definition.workflow,
    phase: definition.phase,
    session: {
      found: Boolean(latestSession),
      jira_issue_key: latestSession?.jira_issue_key ?? null,
      status: latestSession?.status ?? null,
      change_name: latestSession?.openspec_change?.name ?? null,
      tracking_applied: trackingApplied,
      use_session_aware_change_creation: Boolean(
        definition.workflow === 'propose'
        && latestSession
        && (latestSession.status === 'running' || latestSession.status === 'paused')
      ),
      target_block: {
        mode: definition.mode,
        kind: definition.kind,
        description: definition.description,
      },
    },
    ticket: latestSession?.jira_ticket ?? null,
    message: buildTrackMessage(definition, latestSession ?? null, trackingApplied),
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(`Workflow: ${result.workflow}`);
  console.log(`Phase: ${result.phase}`);
  console.log(result.message);
  if (result.session.found) {
    console.log(`Session: ${result.session.status}`);
    console.log(`Issue: ${result.session.jira_issue_key}`);
    if (result.session.change_name) {
      console.log(`Change: ${result.session.change_name}`);
    }
    console.log(`Target block: ${result.session.target_block.mode} / ${result.session.target_block.kind}`);
    if (result.ticket?.summary) {
      console.log(`Imported ticket: ${result.ticket.key} - ${result.ticket.summary}`);
    }
    if (workflow === 'propose') {
      console.log(
        `Session-aware change creation: ${result.session.use_session_aware_change_creation ? 'yes' : 'no'}`
      );
    }
  }

  return result;
}

export async function createTrackedOpsxChange(
  name: string | undefined,
  options: OpsxCreateChangeOptions = {}
): Promise<void> {
  const activeSession = await getActiveSession();
  if (activeSession?.status === 'sync_pending') {
    throw new Error(
      "Active OpenSpec session is pending Jira sync.\nUse 'osj archive --retry' or 'osj timer cancel' before creating a tracked OPSX change."
    );
  }

  const useSession = Boolean(
    activeSession && (activeSession.status === 'running' || activeSession.status === 'paused')
  );
  const autoDescription = useSession
    ? 'OpenSpec generated change artifacts from Jira ticket'
    : 'OpenSpec generated change scaffold';

  let autoBlockStarted = false;
  try {
    if (activeSession?.status === 'running') {
      autoBlockStarted = Boolean(await switchRunningSessionBlock({
        mode: 'ai_autonomous',
        kind: 'spec',
        description: autoDescription,
        source: 'auto',
      }));
    }

    await newChangeCommand(name, {
      schema: options.schema,
      fromSession: useSession,
    });

    if (autoBlockStarted) {
      await switchRunningSessionBlock({
        mode: 'human_agent_interaction',
        kind: 'spec',
        description: OPSX_TRACKING['propose:discovery'].description,
        source: 'auto',
      });
    }
  } catch (error) {
    if (autoBlockStarted) {
      try {
        await switchRunningSessionBlock({
          mode: 'human',
          kind: 'bugfix',
          description: 'Fix failed OPSX propose change creation',
          source: 'auto',
        });
        console.log('Timer switched to human / bugfix.');
        console.log('Suggested command: osj timer bugfix --description "Fix failed OPSX propose change creation"');
      } catch {
        // Preserve the original error if the recovery switch also fails.
      }
    }
    throw error;
  }
}
