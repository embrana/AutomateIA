import { promises as fs } from 'fs';
import path from 'path';
import type {
  AgentRun,
  ApprovalRequest,
  ChangeRuntime,
  ExecutionCycle,
  RuntimeSnapshot,
  SessionRuntime,
  TicketRuntime,
} from '../../core/runtime/types.js';

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export class RuntimeStore {
  getRuntimeRoot(projectDir = process.cwd()): string {
    return path.join(projectDir, '.openspec', 'runtime');
  }

  getTicketsDir(projectDir = process.cwd()): string {
    return path.join(this.getRuntimeRoot(projectDir), 'tickets');
  }

  getTicketDir(ticketKey: string, projectDir = process.cwd()): string {
    return path.join(this.getTicketsDir(projectDir), ticketKey);
  }

  getTicketRuntimePath(ticketKey: string, projectDir = process.cwd()): string {
    return path.join(this.getTicketDir(ticketKey, projectDir), 'ticket-runtime.json');
  }

  getSessionRuntimePath(ticketKey: string, projectDir = process.cwd()): string {
    return path.join(this.getTicketDir(ticketKey, projectDir), 'session.json');
  }

  getChangesDir(ticketKey: string, projectDir = process.cwd()): string {
    return path.join(this.getTicketDir(ticketKey, projectDir), 'changes');
  }

  getChangeDir(ticketKey: string, changeName: string, projectDir = process.cwd()): string {
    return path.join(this.getChangesDir(ticketKey, projectDir), changeName);
  }

  getChangeRuntimePath(ticketKey: string, changeName: string, projectDir = process.cwd()): string {
    return path.join(this.getChangeDir(ticketKey, changeName, projectDir), 'change-runtime.json');
  }

  getCyclesDir(ticketKey: string, changeName: string, projectDir = process.cwd()): string {
    return path.join(this.getChangeDir(ticketKey, changeName, projectDir), 'cycles');
  }

  getCyclePath(ticketKey: string, changeName: string, cycleId: string, projectDir = process.cwd()): string {
    return path.join(this.getCyclesDir(ticketKey, changeName, projectDir), `${cycleId}.json`);
  }

  getAgentRunsDir(ticketKey: string, changeName?: string, projectDir = process.cwd()): string {
    if (changeName) {
      return path.join(this.getChangeDir(ticketKey, changeName, projectDir), 'agent-runs');
    }
    return path.join(this.getTicketDir(ticketKey, projectDir), 'agent-runs');
  }

  getLiveProgressDir(ticketKey: string, changeName?: string, projectDir = process.cwd()): string {
    if (changeName) {
      return path.join(this.getChangeDir(ticketKey, changeName, projectDir), 'live-progress');
    }
    return path.join(this.getTicketDir(ticketKey, projectDir), 'live-progress');
  }

  getLiveProgressPath(ticketKey: string, changeName: string | undefined, runId: string, projectDir = process.cwd()): string {
    return path.join(this.getLiveProgressDir(ticketKey, changeName, projectDir), `${runId}.json`);
  }

  getApprovalsDir(ticketKey: string, projectDir = process.cwd()): string {
    return path.join(this.getTicketDir(ticketKey, projectDir), 'approvals');
  }

  getApprovalPath(ticketKey: string, approvalId: string, projectDir = process.cwd()): string {
    return path.join(this.getApprovalsDir(ticketKey, projectDir), `${approvalId}.json`);
  }

  async getTicketRuntime(ticketKey: string, projectDir = process.cwd()): Promise<TicketRuntime | null> {
    return readJsonFile<TicketRuntime>(this.getTicketRuntimePath(ticketKey, projectDir));
  }

  async getSessionRuntime(ticketKey: string, projectDir = process.cwd()): Promise<SessionRuntime | null> {
    return readJsonFile<SessionRuntime>(this.getSessionRuntimePath(ticketKey, projectDir));
  }

  async getChangeRuntime(ticketKey: string, changeName: string, projectDir = process.cwd()): Promise<ChangeRuntime | null> {
    return readJsonFile<ChangeRuntime>(this.getChangeRuntimePath(ticketKey, changeName, projectDir));
  }

  async getExecutionCycle(ticketKey: string, changeName: string, cycleId: string, projectDir = process.cwd()): Promise<ExecutionCycle | null> {
    return readJsonFile<ExecutionCycle>(this.getCyclePath(ticketKey, changeName, cycleId, projectDir));
  }

  async getApprovalRequest(ticketKey: string, approvalId: string, projectDir = process.cwd()): Promise<ApprovalRequest | null> {
    return readJsonFile<ApprovalRequest>(this.getApprovalPath(ticketKey, approvalId, projectDir));
  }

  async saveTicketRuntime(runtime: TicketRuntime, projectDir = process.cwd()): Promise<void> {
    await writeJsonFile(this.getTicketRuntimePath(runtime.ticket_key, projectDir), runtime);
  }

  async saveSessionRuntime(runtime: SessionRuntime, projectDir = process.cwd()): Promise<void> {
    await writeJsonFile(this.getSessionRuntimePath(runtime.ticket_key, projectDir), runtime);
  }

  async saveChangeRuntime(runtime: ChangeRuntime, projectDir = process.cwd()): Promise<void> {
    await writeJsonFile(this.getChangeRuntimePath(runtime.ticket_key, runtime.change_name, projectDir), runtime);
  }

  async saveExecutionCycle(runtime: ExecutionCycle, projectDir = process.cwd()): Promise<void> {
    if (!runtime.change_name) {
      throw new Error('ExecutionCycle.change_name is required to persist cycle runtime.');
    }
    await writeJsonFile(this.getCyclePath(runtime.ticket_key, runtime.change_name, runtime.cycle_id, projectDir), runtime);
  }

  async saveApprovalRequest(runtime: ApprovalRequest, projectDir = process.cwd()): Promise<void> {
    await writeJsonFile(this.getApprovalPath(runtime.ticket_key, runtime.approval_id, projectDir), runtime);
  }

  async listExecutionCycles(ticketKey: string, changeName: string, projectDir = process.cwd()): Promise<ExecutionCycle[]> {
    try {
      const entries = await fs.readdir(this.getCyclesDir(ticketKey, changeName, projectDir), { withFileTypes: true });
      const cycles = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => readJsonFile<ExecutionCycle>(path.join(this.getCyclesDir(ticketKey, changeName, projectDir), entry.name)))
      );
      return cycles
        .filter((cycle): cycle is ExecutionCycle => cycle !== null)
        .sort((a, b) => a.iteration_no - b.iteration_no);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async listApprovalRequests(ticketKey: string, projectDir = process.cwd()): Promise<ApprovalRequest[]> {
    try {
      const approvalsDir = this.getApprovalsDir(ticketKey, projectDir);
      const entries = await fs.readdir(approvalsDir, { withFileTypes: true });
      const approvals = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => readJsonFile<ApprovalRequest>(path.join(approvalsDir, entry.name)))
      );
      return approvals
        .filter((approval): approval is ApprovalRequest => approval !== null)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async listAgentRuns(ticketKey: string, changeName?: string, projectDir = process.cwd()): Promise<AgentRun[]> {
    try {
      const agentRunsDir = this.getAgentRunsDir(ticketKey, changeName, projectDir);
      const entries = await fs.readdir(agentRunsDir, { withFileTypes: true });
      const runs = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => readJsonFile<AgentRun>(path.join(agentRunsDir, entry.name)))
      );
      return runs
        .filter((run): run is AgentRun => run !== null)
        .sort((a, b) => a.started_at.localeCompare(b.started_at));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async listTicketKeys(projectDir = process.cwd()): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.getTicketsDir(projectDir), { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async getLatestRuntimeSnapshot(projectDir = process.cwd()): Promise<RuntimeSnapshot | null> {
    const ticketKeys = await this.listTicketKeys(projectDir);
    let latest: RuntimeSnapshot | null = null;

    for (const ticketKey of ticketKeys) {
      const ticket = await this.getTicketRuntime(ticketKey, projectDir);
      const session = await this.getSessionRuntime(ticketKey, projectDir);
      if (!ticket || !session) {
        continue;
      }

      const change = session.change_name
        ? await this.getChangeRuntime(ticketKey, session.change_name, projectDir)
        : undefined;
      const snapshot: RuntimeSnapshot = {
        source: 'latest_runtime',
        runtime_root: this.getTicketDir(ticketKey, projectDir),
        ticket,
        session,
        change: change ?? undefined,
      };

      if (!latest || snapshot.session.updated_at > latest.session.updated_at) {
        latest = snapshot;
      }
    }

    return latest;
  }
}
