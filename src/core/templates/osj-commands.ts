import type { CommandTemplate } from './types.js';

function buildReadOnlyCommandContent(commandLabel: string, skillName: string, cliCommand: string): string {
  return `Use the \`${skillName}\` skill to run and summarize \`${cliCommand}\`.

If the skill is not available in this project, fall back to running \`${cliCommand}\` directly with the same extra arguments the user supplied after \`${commandLabel}\`, and still summarize the result clearly.`;
}

export function getOsjRuntimeStatusCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Runtime Status',
    description: 'Inspect the current OpenSpec runtime state through the osj CLI',
    category: 'OSJ Runtime',
    tags: ['osj', 'runtime', 'status', 'jira'],
    content: buildReadOnlyCommandContent(
      '/osj-runtime-status',
      'openspec-osj-runtime-status',
      'osj runtime status'
    ),
  };
}

export function getOsjRuntimeExplainCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Runtime Explain',
    description: 'Explain the current or latest OpenSpec runtime state through the osj CLI',
    category: 'OSJ Runtime',
    tags: ['osj', 'runtime', 'explain', 'jira'],
    content: buildReadOnlyCommandContent(
      '/osj-runtime-explain',
      'openspec-osj-runtime-explain',
      'osj runtime explain'
    ),
  };
}

export function getOsjApprovalShowCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Approval Show',
    description: 'List pending or recent OpenSpec approvals through the osj CLI',
    category: 'OSJ Runtime',
    tags: ['osj', 'approval', 'review', 'jira'],
    content: buildReadOnlyCommandContent(
      '/osj-approval-show',
      'openspec-osj-approval-show',
      'osj approval show'
    ),
  };
}

export function getOsjTimerReportCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Timer Report',
    description: 'Inspect the current OpenSpec timer breakdown through the osj CLI',
    category: 'OSJ Timer',
    tags: ['osj', 'timer', 'worklog', 'jira'],
    content: buildReadOnlyCommandContent(
      '/osj-timer-report',
      'openspec-osj-timer-report',
      'osj timer report'
    ),
  };
}

export function getOsjTimerCancelCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Timer Cancel',
    description: 'Discard the active OpenSpec timer session through the osj CLI',
    category: 'OSJ Timer',
    tags: ['osj', 'timer', 'cancel', 'jira'],
    content: `Use the \`openspec-osj-timer-cancel\` skill to discard the active OpenSpec timer session with \`osj timer cancel\`.

If the skill is not available in this project, first inspect \`osj runtime status\`. Only fall back to \`osj timer cancel\` when the user explicitly wants to discard the active session, especially if the session is \`sync_pending\`.`,
  };
}

export function getOsjTicketShowCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Ticket Show',
    description: 'Show the Jira ticket context imported into the active session through the osj CLI',
    category: 'OSJ Jira',
    tags: ['osj', 'ticket', 'jira', 'session'],
    content: buildReadOnlyCommandContent(
      '/osj-ticket-show',
      'openspec-osj-ticket-show',
      'osj ticket show --json'
    ),
  };
}

export function getOsjTicketsCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Tickets',
    description: 'List assigned Jira tickets in a structured way through the osj CLI',
    category: 'OSJ Jira',
    tags: ['osj', 'tickets', 'jira', 'list'],
    content: buildReadOnlyCommandContent(
      '/osj-tickets',
      'openspec-osj-tickets',
      'osj tickets --json'
    ),
  };
}

export function getOsjPurposeStartCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Purpose Start',
    description: 'List available Jira tickets or start an OpenSpec session from a chosen ticket',
    category: 'OSJ Jira',
    tags: ['osj', 'purpose', 'jira', 'timer'],
    content: `Use the \`openspec-osj-purpose-start\` skill to either list available Jira tickets or start \`osj purpose --jira <KEY> --import-ticket\`.

If the skill is not available in this project, fall back to:
- \`osj tickets --json\` when no issue key was provided
- \`osj purpose --jira <KEY> --import-ticket\` when a Jira issue key or explicit \`--jira\` argument was provided`,
  };
}

export function getOsjArchiveSessionCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Archive Session',
    description: 'Safely close only the active timer session and Jira worklog when no active change archive should run',
    category: 'OSJ Timer',
    tags: ['osj', 'archive', 'timer', 'worklog'],
    content: `Use the \`openspec-osj-archive-session\` skill to safely close only the active timer session and Jira worklog.

If the skill is not available in this project, first inspect \`osj runtime status\`. Only fall back to \`osj archive --comment "Implementation session"\` when the active session does not point at a non-archived change.`,
  };
}

export function getOsjArchiveRetryCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Archive Retry',
    description: 'Retry a pending Jira worklog sync after an archive left the session in sync_pending',
    category: 'OSJ Timer',
    tags: ['osj', 'archive', 'retry', 'worklog'],
    content: buildReadOnlyCommandContent(
      '/osj-archive-retry',
      'openspec-osj-archive-retry',
      'osj archive --retry'
    ),
  };
}
