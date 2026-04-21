/**
 * New Change Command
 *
 * Creates a new change directory with optional description and schema.
 */

import ora from 'ora';
import path from 'path';
import { createChange, validateChangeName } from '../../utils/change-utils.js';
import { validateSchemaExists } from './shared.js';
import { createChangeFromJiraIssue, createChangeFromTicket, fetchImportedJiraTicket } from '../../core/timer/ticket-change.js';
import { getActiveSession, saveActiveSession } from '../../core/timer/store.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NewChangeOptions {
  description?: string;
  schema?: string;
  fromTicket?: string;
  fromSession?: boolean;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

export async function newChangeCommand(name: string | undefined, options: NewChangeOptions): Promise<void> {
  const projectRoot = process.cwd();

  // Validate schema if provided
  if (options.schema) {
    validateSchemaExists(options.schema, projectRoot);
  }

  if (options.fromTicket && options.fromSession) {
    throw new Error('Use either --from-ticket <issue-key> or --from-session, not both.');
  }

  async function maybeAttachChangeToActiveSession(change: { name: string; path: string; schema: string }, expectedIssueKey?: string): Promise<void> {
    const activeSession = await getActiveSession(projectRoot);
    if (!activeSession || activeSession.status !== 'running') {
      return;
    }
    if (expectedIssueKey && activeSession.jira_issue_key !== expectedIssueKey) {
      return;
    }

    await saveActiveSession({
      ...activeSession,
      openspec_change: {
        name: change.name,
        path: change.path,
        schema: change.schema,
      },
    }, projectRoot);
  }

  if (options.fromSession) {
    const activeSession = await getActiveSession(projectRoot);
    if (!activeSession) {
      throw new Error('No active OpenSpec session found.\nStart a session first with `osj purpose --pick --import-ticket` or `osj purpose --jira PROJ-123 --import-ticket`.');
    }

    if (name) {
      const validation = validateChangeName(name);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    const issueKey = activeSession.jira_issue_key;
    const spinner = ora(`Creating change from active Jira session '${issueKey}'...`).start();

    try {
      const ticket = activeSession.jira_ticket ?? await fetchImportedJiraTicket(issueKey);
      const result = await createChangeFromTicket(ticket, {
        name,
        schema: options.schema,
      });
      await maybeAttachChangeToActiveSession(result, issueKey);
      spinner.succeed(
        `Created change '${result.name}' from active Jira session ${ticket.key} at openspec/changes/${result.name}/ (schema: ${result.schema})`
      );
      return;
    } catch (error) {
      spinner.fail(`Failed to create change from active Jira session '${issueKey}'`);
      throw error;
    }
  }

  if (options.fromTicket) {
    if (name) {
      const validation = validateChangeName(name);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    const spinner = ora(`Creating change from Jira ticket '${options.fromTicket}'...`).start();

    try {
      const result = await createChangeFromJiraIssue(options.fromTicket, {
        name,
        schema: options.schema,
      });
      await maybeAttachChangeToActiveSession(result, options.fromTicket);
      spinner.succeed(
        `Created change '${result.name}' from Jira ticket ${result.ticket.key} at openspec/changes/${result.name}/ (schema: ${result.schema})`
      );
      return;
    } catch (error) {
      spinner.fail(`Failed to create change from Jira ticket '${options.fromTicket}'`);
      throw error;
    }
  }

  if (!name) {
    throw new Error('Missing required argument <name>');
  }

  const validation = validateChangeName(name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const schemaDisplay = options.schema ? ` with schema '${options.schema}'` : '';
  const spinner = ora(`Creating change '${name}'${schemaDisplay}...`).start();

  try {
    const result = await createChange(projectRoot, name, { schema: options.schema });

    // If description provided, create README.md with description
    if (options.description) {
      const { promises: fs } = await import('fs');
      const changeDir = path.join(projectRoot, 'openspec', 'changes', name);
      const readmePath = path.join(changeDir, 'README.md');
      await fs.writeFile(readmePath, `# ${name}\n\n${options.description}\n`, 'utf-8');
    }

    spinner.succeed(`Created change '${name}' at openspec/changes/${name}/ (schema: ${result.schema})`);
  } catch (error) {
    spinner.fail(`Failed to create change '${name}'`);
    throw error;
  }
}
