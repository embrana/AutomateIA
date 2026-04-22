import { promises as fs } from 'fs';
import path from 'path';
import type { AgentRun } from '../types.js';
import { RuntimeStore } from '../../../storage/fs/RuntimeStore.js';

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export class ArtifactManager {
  constructor(
    private readonly runtimeStore = new RuntimeStore(),
    private readonly projectRoot = process.cwd()
  ) {}

  getProjectRoot(): string {
    return this.projectRoot;
  }

  async writeTicketJson(ticketKey: string, category: string, filename: string, value: unknown): Promise<string> {
    const filePath = path.join(this.runtimeStore.getTicketDir(ticketKey, this.projectRoot), category, filename);
    await writeJsonFile(filePath, value);
    return this.toProjectRelative(filePath);
  }

  async writeTicketMarkdown(ticketKey: string, category: string, filename: string, content: string): Promise<string> {
    const filePath = path.join(this.runtimeStore.getTicketDir(ticketKey, this.projectRoot), category, filename);
    await writeTextFile(filePath, content.endsWith('\n') ? content : `${content}\n`);
    return this.toProjectRelative(filePath);
  }

  async writeChangeJson(ticketKey: string, changeName: string, category: string, filename: string, value: unknown): Promise<string> {
    const filePath = path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), category, filename);
    await writeJsonFile(filePath, value);
    return this.toProjectRelative(filePath);
  }

  async writeChangeMarkdown(ticketKey: string, changeName: string, category: string, filename: string, content: string): Promise<string> {
    const filePath = path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), category, filename);
    await writeTextFile(filePath, content.endsWith('\n') ? content : `${content}\n`);
    return this.toProjectRelative(filePath);
  }

  async writeAgentRun(ticketKey: string, changeName: string | undefined, run: AgentRun): Promise<string> {
    if (changeName) {
      return this.writeChangeJson(ticketKey, changeName, 'agent-runs', `${run.agent_run_id}.json`, run);
    }
    return this.writeTicketJson(ticketKey, 'agent-runs', `${run.agent_run_id}.json`, run);
  }

  async readJsonRef<T>(ref: string): Promise<T | null> {
    const filePath = path.isAbsolute(ref) ? ref : path.join(this.projectRoot, ref);
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

  async fileExists(ref: string): Promise<boolean> {
    const filePath = path.isAbsolute(ref) ? ref : path.join(this.projectRoot, ref);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getTicketContextRef(ticketKey: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getTicketDir(ticketKey, this.projectRoot), 'context', 'normalized-context.json'));
  }

  getChangeContextRef(ticketKey: string, changeName: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), 'context', 'normalized-context.json'));
  }

  getPlanningRef(ticketKey: string, changeName: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), 'planning', 'execution-plan.json'));
  }

  getImplementationRef(ticketKey: string, changeName: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), 'implementation', 'change-report.json'));
  }

  getCriticRef(ticketKey: string, changeName: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), 'review', 'critic-report.json'));
  }

  getValidationRef(ticketKey: string, changeName: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), 'validation', 'validation-result.json'));
  }

  getDeliveryClosureRef(ticketKey: string, changeName: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), 'delivery', 'closure-summary.json'));
  }

  getArchiveDecisionRef(ticketKey: string, changeName: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getChangeDir(ticketKey, changeName, this.projectRoot), 'delivery', 'archive-decision.json'));
  }

  getApprovalRef(ticketKey: string, approvalId: string): string {
    return this.toProjectRelative(path.join(this.runtimeStore.getApprovalsDir(ticketKey, this.projectRoot), `${approvalId}.json`));
  }

  toProjectRelative(filePath: string): string {
    return path.relative(this.projectRoot, filePath).split(path.sep).join('/');
  }
}
