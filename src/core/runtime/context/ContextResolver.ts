import { readProjectConfig } from '../../project-config.js';
import { fetchImportedJiraTicket } from '../../timer/ticket-change.js';
import { getActiveSession, saveActiveSession } from '../../timer/store.js';
import type { ImportedJiraTicket } from '../../timer/types.js';
import { SessionManager } from '../session/SessionManager.js';
import { ArtifactManager } from '../artifacts/ArtifactManager.js';
import type { NormalizedContext } from '../../../agents/base/Agent.js';

export interface ResolvedRuntimeContext {
  timerSession: NonNullable<Awaited<ReturnType<typeof getActiveSession>>>;
  runtimeSnapshot: NonNullable<Awaited<ReturnType<SessionManager['getCurrentRuntimeSnapshot']>>>;
  ticket: ImportedJiraTicket;
  projectConfig: ReturnType<typeof readProjectConfig>;
  existingNormalizedContext?: NormalizedContext;
}

export class ContextResolver {
  constructor(
    private readonly sessionManager = new SessionManager(),
    private readonly artifactManager = new ArtifactManager()
  ) {}

  async resolveActive(): Promise<ResolvedRuntimeContext> {
    const session = await getActiveSession();
    if (!session) {
      throw new Error('No active OpenSpec session found. Start a session with `osj purpose` or `osj timer start` first.');
    }

    let ticket = session.jira_ticket;
    if (!ticket) {
      ticket = await fetchImportedJiraTicket(session.jira_issue_key);
      const updatedSession = {
        ...session,
        jira_ticket: ticket,
      };
      await saveActiveSession(updatedSession);
      await this.sessionManager.syncFromTimerSession(updatedSession);
    }

    const runtimeSnapshot = await this.sessionManager.getCurrentRuntimeSnapshot();
    if (!runtimeSnapshot) {
      throw new Error('OpenSpec runtime state is not available for the active session.');
    }

    const projectConfig = readProjectConfig(this.artifactManager.getProjectRoot());
    const existingNormalizedContext = await this.loadExistingNormalizedContext(runtimeSnapshot.ticket.ticket_key, runtimeSnapshot.session.change_name);

    return {
      timerSession: ticket === session.jira_ticket ? session : { ...session, jira_ticket: ticket },
      runtimeSnapshot,
      ticket,
      projectConfig,
      existingNormalizedContext: existingNormalizedContext ?? undefined,
    };
  }

  private async loadExistingNormalizedContext(
    ticketKey: string,
    changeName?: string
  ): Promise<NormalizedContext | null> {
    if (changeName) {
      const changeRef = this.artifactManager.getChangeContextRef(ticketKey, changeName);
      const changeContext = await this.artifactManager.readJsonRef<NormalizedContext>(changeRef);
      if (changeContext) {
        return changeContext;
      }
    }

    return this.artifactManager.readJsonRef<NormalizedContext>(this.artifactManager.getTicketContextRef(ticketKey));
  }
}
