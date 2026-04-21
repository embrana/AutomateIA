import { getTimerConfig } from './config.js';
import { JiraClient, resolveJiraConfig } from './jira-client.js';
import type { JiraTicketSummary } from './types.js';

const TICKET_LIST_FIELDS = ['summary', 'status', 'assignee'];
const DEFAULT_MAX_RESULTS = 20;

export interface ListAssignedTicketsOptions {
  project?: string;
  allProjects?: boolean;
  limit?: number;
  jql?: string;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function getFieldObject(issue: Record<string, unknown>): Record<string, unknown> {
  return typeof issue.fields === 'object' && issue.fields !== null
    ? issue.fields as Record<string, unknown>
    : {};
}

function normalizeTicketSummary(
  issue: Record<string, unknown>,
  jira: JiraClient,
  fallbackKey = 'UNKNOWN'
): JiraTicketSummary {
  const fields = getFieldObject(issue);
  const status = typeof fields.status === 'object' && fields.status !== null
    ? getString((fields.status as Record<string, unknown>).name)
    : null;
  const assignee = typeof fields.assignee === 'object' && fields.assignee !== null
    ? getString((fields.assignee as Record<string, unknown>).displayName)
    : null;
  const key = getString(issue.key) ?? fallbackKey;

  return {
    key,
    summary: getString(fields.summary) ?? '',
    status,
    assignee,
    url: jira.getIssueUrl(key),
  };
}

function quoteJqlValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildAssignedTicketsJql(options: {
  project?: string;
  allProjects?: boolean;
  customJql?: string;
} = {}): string {
  if (options.customJql?.trim()) {
    return options.customJql.trim();
  }

  const clauses = ['assignee = currentUser()', 'resolution IS EMPTY'];
  if (options.project && !options.allProjects) {
    clauses.unshift(`project = ${quoteJqlValue(options.project)}`);
  }

  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

export async function listAssignedTickets(
  options: ListAssignedTicketsOptions = {}
): Promise<JiraTicketSummary[]> {
  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  const jira = new JiraClient(jiraConfig);
  const project = options.project ?? (!options.allProjects ? config.jira?.default_project : undefined);
  const maxResults = Math.max(1, Math.min(options.limit ?? DEFAULT_MAX_RESULTS, 100));
  const jql = buildAssignedTicketsJql({
    project,
    allProjects: options.allProjects,
    customJql: options.jql,
  });

  const response = await jira.searchIssues({
    jql,
    fields: TICKET_LIST_FIELDS,
    maxResults,
  });
  const issues = Array.isArray(response.issues) ? response.issues : [];

  return issues
    .filter((issue): issue is Record<string, unknown> => typeof issue === 'object' && issue !== null)
    .map((issue, index) => normalizeTicketSummary(issue, jira, `UNKNOWN-${index + 1}`));
}

export function formatTicketSummary(ticket: JiraTicketSummary): string {
  const status = ticket.status ? ` [${ticket.status}]` : '';
  const assignee = ticket.assignee ? ` - ${ticket.assignee}` : '';
  return `${ticket.key}${status}: ${ticket.summary}${assignee}`;
}
