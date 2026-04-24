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
