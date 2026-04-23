import { promises as fs } from 'fs';
import { SessionManager } from './session/SessionManager.js';
import { RuntimeStore } from '../../storage/fs/RuntimeStore.js';
import type { AgentRun } from './types.js';
import { inspectWorkspaceDiffWithExclusions } from './workspace-diff.js';

const BACKEND_PHASE_TTL_MS = 15_000;

interface BackendProgressSnapshot {
  agent_name?: string;
  run_id?: string;
  phase?: string;
  phase_source?: 'backend';
  input_tokens?: number | null;
  output_tokens?: number | null;
  updated_at?: string;
}

export interface OrchestrateHeartbeatSnapshot {
  activeAgent: string;
  cycleId: string;
  elapsedMs: number;
  phase: string;
  phaseSource: 'backend' | 'inferred';
  addedLines: number;
  removedLines: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

function formatTokens(value: number | null): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return 'N/A';
}

function inferPhase(
  agentName: AgentRun['agent_name'],
  hasWorkspaceEdits: boolean
): { phase: string; phaseSource: 'inferred' } {
  switch (agentName) {
    case 'implementation_agent':
      return {
        phase: hasWorkspaceEdits ? 'writing' : 'thinking',
        phaseSource: 'inferred',
      };
    case 'validation_agent':
      return { phase: 'running tests', phaseSource: 'inferred' };
    case 'critic_agent':
    case 'delivery_agent':
      return { phase: 'reviewing', phaseSource: 'inferred' };
    case 'context_agent':
    case 'spec_agent':
    case 'planning_agent':
      return { phase: 'thinking', phaseSource: 'inferred' };
    default:
      return { phase: 'waiting on backend', phaseSource: 'inferred' };
  }
}

async function readBackendProgress(progressPath: string): Promise<BackendProgressSnapshot | null> {
  try {
    const raw = await fs.readFile(progressPath, 'utf-8');
    return JSON.parse(raw) as BackendProgressSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function isFreshBackendProgress(progress: BackendProgressSnapshot, runId: string, nowMs: number): boolean {
  if (!progress.phase || progress.run_id !== runId || !progress.updated_at) {
    return false;
  }
  const updatedMs = Date.parse(progress.updated_at);
  return Number.isFinite(updatedMs) && nowMs - updatedMs <= BACKEND_PHASE_TTL_MS;
}

export async function collectOrchestrateHeartbeat(
  projectRoot = process.cwd(),
  sessionManager = new SessionManager(),
  runtimeStore = new RuntimeStore()
): Promise<OrchestrateHeartbeatSnapshot | null> {
  const snapshot = await sessionManager.getCurrentRuntimeSnapshot();
  if (!snapshot?.change || snapshot.session.current_cycle <= 0) {
    return null;
  }

  const cycleId = `cycle-${String(snapshot.session.current_cycle).padStart(3, '0')}`;
  const runs = await runtimeStore.listAgentRuns(snapshot.ticket.ticket_key, snapshot.change.change_name, projectRoot);
  const runningRun = [...runs]
    .reverse()
    .find((run) => run.cycle_id === cycleId && run.status === 'RUNNING');

  if (!runningRun) {
    return null;
  }

  const excludedPrefixes = [
    '.openspec/',
    `openspec/changes/${snapshot.change.change_name}/`,
  ];
  const diff = await inspectWorkspaceDiffWithExclusions(projectRoot, excludedPrefixes);
  const nowMs = Date.now();
  const progressPath = runtimeStore.getLiveProgressPath(
    snapshot.ticket.ticket_key,
    snapshot.change.change_name,
    runningRun.agent_run_id,
    projectRoot
  );
  const backendProgress = await readBackendProgress(progressPath);
  const strictPhaseAvailable = backendProgress
    ? isFreshBackendProgress(backendProgress, runningRun.agent_run_id, nowMs)
    : false;
  const phase = strictPhaseAvailable
    ? {
        phase: backendProgress?.phase ?? 'waiting on backend',
        phaseSource: 'backend' as const,
      }
    : inferPhase(runningRun.agent_name, diff.addedLines + diff.removedLines > 0);

  return {
    activeAgent: runningRun.agent_name,
    cycleId,
    elapsedMs: Math.max(0, nowMs - Date.parse(runningRun.started_at)),
    phase: phase.phase,
    phaseSource: phase.phaseSource,
    addedLines: diff.addedLines,
    removedLines: diff.removedLines,
    inputTokens: strictPhaseAvailable ? backendProgress?.input_tokens ?? null : null,
    outputTokens: strictPhaseAvailable ? backendProgress?.output_tokens ?? null : null,
  };
}

export function buildOrchestrateHeartbeatLine(heartbeat: OrchestrateHeartbeatSnapshot): string {
  const diffSummary =
    heartbeat.addedLines === 0 && heartbeat.removedLines === 0
      ? 'no workspace edits detected yet'
      : `diff +${heartbeat.addedLines}/-${heartbeat.removedLines}`;

  return [
    'Orchestration heartbeat',
    `agent=${heartbeat.activeAgent}`,
    `phase=${heartbeat.phase} (${heartbeat.phaseSource})`,
    `elapsed=${formatElapsed(heartbeat.elapsedMs)}`,
    `cycle=${heartbeat.cycleId}`,
    diffSummary,
    `tokens_in=${formatTokens(heartbeat.inputTokens)}`,
    `tokens_out=${formatTokens(heartbeat.outputTokens)}`,
  ].join(' | ');
}

export class OrchestrateHeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    private readonly projectRoot = process.cwd(),
    private readonly intervalMs = 4000,
    private readonly logger: (line: string) => void = console.log,
    private readonly sessionManager = new SessionManager(),
    private readonly runtimeStore = new RuntimeStore()
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.inFlight) {
        return;
      }
      this.inFlight = true;
      void this.tick().finally(() => {
        this.inFlight = false;
      });
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async tick(): Promise<void> {
    const heartbeat = await collectOrchestrateHeartbeat(this.projectRoot, this.sessionManager, this.runtimeStore);
    if (!heartbeat) {
      return;
    }
    this.logger(buildOrchestrateHeartbeatLine(heartbeat));
  }
}
