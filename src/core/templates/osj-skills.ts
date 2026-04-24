import type { SkillTemplate } from './types.js';

function buildReadOnlySkillInstructions(commandLabel: string, cliCommand: string, summaryBullets: string): string {
  return `Run and explain the \`${cliCommand}\` command for the user.

**Input**

Any text supplied with \`${commandLabel}\` should be appended as extra CLI arguments exactly as written.

**Steps**

1. Build the command:
   - default: \`${cliCommand}\`
   - if extra arguments were provided, append them to the default command
2. Run the command in the current project.
3. If the command reports that no runtime, approval, or timer data exists, explain that clearly instead of failing silently.
4. Summarize the result for the user.

**Command-specific focus**

${summaryBullets}

**Response format**

Respond with compact Markdown sections in this order:

**Status**
- One line stating the outcome of the command.

**Key facts**
- Short bullets with the most important exact values from the CLI output.

**Conclusion**
- One or two bullets explaining what the current state means for the user.

**State conflicts**
- List conflicting, stale, or surprising state combinations that the user should notice.
- If none exist, write \`- None.\`

**Next step**
- Give the safest next command or write \`- None.\` when no action is needed.

**Evidence**
- Include only when the CLI points to relevant artifact paths, evidence files, or structured output worth surfacing.

**Style rules**

- Do not narrate execution with phrases like "I ran", "The CLI reported", or "using the skill".
- Do not mention the helper, prompt, or skill implementation details.
- Prefer bullets over paragraphs.
- Prefer exact CLI values over guesses.
- Keep the answer scan-friendly and operational.
- If the command shows that nothing is active or nothing exists, say that directly in **Status** and **Conclusion**.
- If the CLI reveals stale or conflicting state, call it out explicitly in **State conflicts**.

**Guardrails**

- This helper is read-only. Do not mutate runtime state, approvals, timers, or Jira data.
- Prefer the real \`osj\` CLI output over guesses.
- If the command fails, show the relevant error and suggest the safest next step.`;
}

export function getOsjRuntimeStatusSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-osj-runtime-status',
    description: 'Run `osj runtime status` and summarize the current runtime state for the user.',
    instructions: buildReadOnlySkillInstructions(
      '/osj-runtime-status',
      'osj runtime status',
      `- Report the runtime source, ticket, session, change, cycle, activity, and pending approvals when present.
- Call out the active or last-running agent if the output includes it.
- End with the most likely next command, for example \`osj orchestrate --until implementation\` or \`osj approval show\`.`
    ),
    license: 'MIT',
    compatibility: 'Requires the osj CLI in the current project.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOsjRuntimeExplainSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-osj-runtime-explain',
    description: 'Run `osj runtime explain` and summarize blockers, evidence, and next action.',
    instructions: buildReadOnlySkillInstructions(
      '/osj-runtime-explain',
      'osj runtime explain',
      `- Highlight the primary reason, blockers, pending approvals, and suggested next action.
- If the user passed \`--json\`, include the structured output and point out the most important fields.
- Surface the primary evidence artifact when one is reported.`
    ),
    license: 'MIT',
    compatibility: 'Requires the osj CLI in the current project.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOsjApprovalShowSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-osj-approval-show',
    description: 'Run `osj approval show` and summarize pending or resolved approvals.',
    instructions: buildReadOnlySkillInstructions(
      '/osj-approval-show',
      'osj approval show',
      `- List each approval id, scope, status, reason, and related change when available.
- If there are no approvals, say that clearly.
- Suggest the next safe command, such as \`osj approval accept <id>\`, only when approvals are actually present.`
    ),
    license: 'MIT',
    compatibility: 'Requires the osj CLI in the current project.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOsjTimerReportSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-osj-timer-report',
    description: 'Run `osj timer report` and summarize timer state, totals, and worklog readiness.',
    instructions: buildReadOnlySkillInstructions(
      '/osj-timer-report',
      'osj timer report',
      `- Summarize the active session, recorded blocks, totals, and worklog readiness.
- Distinguish clearly between human, ai_autonomous, and human_agent_interaction time when the report exposes those splits.
- If the report suggests an archive or timer action, mention it explicitly.`
    ),
    license: 'MIT',
    compatibility: 'Requires the osj CLI in the current project.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOsjTicketsSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-osj-tickets',
    description: 'Run `osj tickets --json` and summarize available Jira tickets in a structured list.',
    instructions: buildReadOnlySkillInstructions(
      '/osj-tickets',
      'osj tickets --json',
      `- List tickets in a structured, scan-friendly way that includes ticket key and title/summary.
- Include status, assignee, and URL when the CLI exposes them.
- In **Next step**, suggest \`/osj-purpose-start <KEY>\` using a concrete ticket from the returned list when one exists.`
    ),
    license: 'MIT',
    compatibility: 'Requires the osj CLI in the current project.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}

export function getOsjPurposeStartSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-osj-purpose-start',
    description: 'List available Jira tickets or start an OpenSpec session with `osj purpose --jira <KEY> --import-ticket`.',
    instructions: `Help the user start an OpenSpec session from a Jira ticket.

**Input**

Text supplied with \`/osj-purpose-start\` can be:

- a Jira issue key like \`REB-234\`
- explicit CLI args like \`--jira REB-234 --create-change\`
- nothing, in which case you should list available tickets instead of starting a session

**Steps**

1. Inspect the supplied text.
2. If no Jira issue key or \`--jira\` argument is present:
   - run \`osj tickets --json\`
   - summarize tickets in a structured list that includes ticket key and title/summary
   - do not start a session yet
   - in **Next step**, show the exact command to run, for example \`/osj-purpose-start REB-234\`
3. If the supplied text starts with an issue key like \`REB-234\`:
   - build \`osj purpose --jira REB-234 --import-ticket\`
   - append any remaining text after the issue key exactly as written
4. If the supplied text already uses explicit CLI arguments:
   - run \`osj purpose\` with those arguments
   - ensure \`--import-ticket\` is included unless it is already present
5. Run the command in the current project.
6. Summarize the result for the user.

**Response format**

Respond with compact Markdown sections in this order:

**Status**
- One line stating whether tickets were listed or a session was started.

**Command**
- Show the exact \`osj\` CLI command that was run.
- If no command was run because the user did not provide a ticket yet, write \`- Not run.\`

**Key facts**
- Short bullets with the most important exact values from the CLI output.
- When listing tickets, use bullets like \`REB-234 — Title\`.

**Conclusion**
- One or two bullets explaining what the current state means for the user.

**State conflicts**
- List conflicting, stale, or blocking state combinations the user should notice.
- If none exist, write \`- None.\`

**Next step**
- Give the safest next command.
- If tickets were only listed, include a concrete example such as \`/osj-purpose-start REB-234\`.

**Evidence**
- Include only when the CLI points to relevant artifact paths, URLs, or structured output worth surfacing.

**Style rules**

- Do not narrate execution with phrases like "I ran", "The CLI reported", or "using the skill".
- Do not mention the helper, prompt, or skill implementation details.
- Prefer bullets over paragraphs.
- Prefer exact CLI values over guesses.
- Keep the answer scan-friendly and operational.
- If the command fails because a session already exists, call that out in **State conflicts** and suggest the safest next command such as \`osj runtime status\`, \`osj timer report\`, \`osj archive\`, or \`osj timer cancel\`.

**Guardrails**

- Mutate state only when a Jira issue key or explicit \`--jira\` argument is present.
- Never guess a Jira issue key. If none was provided, list tickets instead.
- Prefer the real \`osj\` CLI output over guesses.
- If the command fails, show the relevant error and suggest the safest next step.`,
    license: 'MIT',
    compatibility: 'Requires the osj CLI in the current project.',
    metadata: { author: 'openspec', version: '1.0' },
  };
}
