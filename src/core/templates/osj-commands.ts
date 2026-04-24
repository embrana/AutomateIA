import type { CommandTemplate } from './types.js';

function buildReadOnlyCommandContent(commandLabel: string, cliCommand: string, summaryBullets: string): string {
  return `Use the \`${commandLabel}\` helper to run the corresponding \`osj\` CLI command inside the project and explain the result.

**Input**: Any text after \`${commandLabel}\` should be treated as extra CLI arguments and appended exactly as written.

**Steps**

1. Build the command:
   - default: \`${cliCommand}\`
   - if extra arguments were provided, append them to the default command
2. Run the command in the current project.
3. If the command reports that no runtime, approval, or timer data exists, explain that clearly instead of failing silently.
4. Summarize the result for the user.

**Summarize**

${summaryBullets}

**Guardrails**

- This helper is read-only. Do not mutate runtime state, approvals, timers, or Jira data.
- Prefer the real \`osj\` CLI output over guesses.
- If the command fails, show the relevant error and suggest the safest next step.`;
}

export function getOsjRuntimeStatusCommandTemplate(): CommandTemplate {
  return {
    name: 'OSJ: Runtime Status',
    description: 'Inspect the current OpenSpec runtime state through the osj CLI',
    category: 'OSJ Runtime',
    tags: ['osj', 'runtime', 'status', 'jira'],
    content: buildReadOnlyCommandContent(
      '/osj-runtime-status',
      'osj runtime status',
      `- Report the runtime source, ticket, session, change, cycle, activity, and pending approvals when present.
- Call out the active or last-running agent if the output includes it.
- End with the most likely next command, for example \`osj orchestrate --until implementation\` or \`osj approval show\`.`
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
      'osj runtime explain',
      `- Highlight the primary reason, blockers, pending approvals, and suggested next action.
- If the user passed \`--json\`, include the structured output and point out the most important fields.
- Surface the primary evidence artifact when one is reported.`
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
      'osj approval show',
      `- List each approval id, scope, status, reason, and related change when available.
- If there are no approvals, say that clearly.
- Suggest the next safe command, such as \`osj approval accept <id>\`, only when approvals are actually present.`
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
      'osj timer report',
      `- Summarize the active session, recorded blocks, totals, and worklog readiness.
- Distinguish clearly between human, ai_autonomous, and human_agent_interaction time when the report exposes those splits.
- If the report suggests an archive or timer action, mention it explicitly.`
    ),
  };
}
