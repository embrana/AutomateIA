import { promises as fs } from 'fs';
import path from 'path';
import { createChangeFromRootSpec, createChangeFromTicket, parseStructuredSdd } from '../../core/timer/ticket-change.js';
import { ArtifactManager } from '../../core/runtime/artifacts/ArtifactManager.js';
import { saveActiveSession } from '../../core/timer/store.js';
import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';

export interface SpecAgentOutput {
  change_name: string;
  created_files: string[];
  scenarios_generated: number;
  ambiguities_remaining: number;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toProjectRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

export class SpecAgent implements Agent<NormalizedContext | undefined, SpecAgentOutput> {
  readonly name = 'spec_agent' as const;
  private readonly artifactManager = new ArtifactManager();

  async canRun(context: AgentContext): Promise<boolean> {
    return context.envelope.constraints.canEditSpecs;
  }

  async run(input: NormalizedContext | undefined, context: AgentContext): Promise<AgentResultEnvelope<SpecAgentOutput>> {
    const createdFiles: string[] = [];
    let changeName = context.timerSession.openspec_change?.name;
    const ticket = context.ticket;
    const projectRoot = context.projectRoot;
    const rootSpecRef = this.artifactManager.getRootSpecRef(context.envelope.ticket_key);
    const rootSpecMarkdown = await this.readMarkdownRef(rootSpecRef);
    const changeNameHint = await this.artifactManager.readJsonRef<{ name?: string }>(
      this.artifactManager.getChangeNameHintRef(context.envelope.ticket_key)
    );

    if (!changeName) {
      const created = rootSpecMarkdown
        ? await createChangeFromRootSpec(ticket, rootSpecMarkdown, {
            name: changeNameHint?.name,
            rootSpecPath: rootSpecRef,
          })
        : await createChangeFromTicket(ticket, { name: changeNameHint?.name });
      changeName = created.name;
      createdFiles.push(
        toProjectRelative(projectRoot, path.join(created.path, 'proposal.md')),
        toProjectRelative(projectRoot, path.join(created.path, 'tasks.md')),
        toProjectRelative(projectRoot, path.join(created.path, 'jira-ticket.md')),
        toProjectRelative(projectRoot, path.join(created.path, 'specs', created.name, 'spec.md')),
      );
      if (rootSpecMarkdown) {
        createdFiles.push(toProjectRelative(projectRoot, path.join(created.path, 'root-spec.md')));
      }

      const updatedSession = {
        ...context.timerSession,
        openspec_change: {
          name: created.name,
          path: created.path,
          schema: created.schema,
        },
      };
      await saveActiveSession(updatedSession);
      await context.sessionManager.syncFromTimerSession(updatedSession, {
        overrideTicketState: context.runtimeSnapshot.ticket.state === 'DISCOVERED'
          || context.runtimeSnapshot.ticket.state === 'CONTEXT_IMPORTED'
          ? 'SPEC_READY'
          : undefined,
      });
    } else {
      const expectedFiles = [
        path.join(projectRoot, 'openspec', 'changes', changeName, 'proposal.md'),
        path.join(projectRoot, 'openspec', 'changes', changeName, 'tasks.md'),
        path.join(projectRoot, 'openspec', 'changes', changeName, 'jira-ticket.md'),
        path.join(projectRoot, 'openspec', 'changes', changeName, 'specs', changeName, 'spec.md'),
      ];
      for (const filePath of expectedFiles) {
        if (await fileExists(filePath)) {
          createdFiles.push(toProjectRelative(projectRoot, filePath));
        }
      }
      await context.sessionManager.syncFromTimerSession(context.timerSession, {
        overrideTicketState: context.runtimeSnapshot.ticket.state === 'DISCOVERED'
          || context.runtimeSnapshot.ticket.state === 'CONTEXT_IMPORTED'
          ? 'SPEC_READY'
          : undefined,
      });
    }

    const structuredRootSpec = rootSpecMarkdown
      ? parseStructuredSdd(rootSpecMarkdown, ticket.summary || `Implement ${ticket.key}`)
      : null;
    const scenariosGenerated = structuredRootSpec?.acceptanceCriteria.length
      ?? input?.acceptance_criteria.length
      ?? context.existingNormalizedContext?.acceptance_criteria.length
      ?? 0;
    const ambiguitiesRemaining = input?.ambiguities.length
      ?? context.existingNormalizedContext?.ambiguities.length
      ?? 0;

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output: {
        change_name: changeName,
        created_files: createdFiles,
        scenarios_generated: scenariosGenerated,
        ambiguities_remaining: ambiguitiesRemaining,
      },
      artifact_refs: [],
      recommended_next_action: 'RUN_PLANNING_AGENT',
    };
  }

  private async readMarkdownRef(ref: string): Promise<string | null> {
    const filePath = path.isAbsolute(ref) ? ref : path.join(this.artifactManager.getProjectRoot(), ref);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
