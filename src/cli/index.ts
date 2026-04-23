import { Command } from 'commander';
import { createRequire } from 'module';
import { select } from '@inquirer/prompts';
import ora from 'ora';
import path from 'path';
import { promises as fs } from 'fs';
import { resolveArchiveRouting } from './archive-routing.js';
import { AI_TOOLS } from '../core/config.js';
import { UpdateCommand } from '../core/update.js';
import { ListCommand } from '../core/list.js';
import { ArchiveCommand } from '../core/archive.js';
import { ViewCommand } from '../core/view.js';
import { registerSpecCommand } from '../commands/spec.js';
import { ChangeCommand } from '../commands/change.js';
import { ValidateCommand } from '../commands/validate.js';
import { ShowCommand } from '../commands/show.js';
import { CompletionCommand } from '../commands/completion.js';
import { FeedbackCommand } from '../commands/feedback.js';
import { registerConfigCommand } from '../commands/config.js';
import { registerSchemaCommand } from '../commands/schema.js';
import { registerHlpCommand } from '../commands/hlp.js';
import {
  addJiraArchiveComment,
  archiveTimer,
  cancel as cancelTimer,
  pause as pauseTimer,
  purpose as startTimerSession,
  report as timerReport,
  resume as resumeTimer,
  startManualHumanTimer,
  status as timerStatus,
  switchBlock as switchTimerBlock,
  switchToAutomaticBlock,
  switchToDefaultHumanWork,
  validateTimerActorMode,
  validateTimerWorkKind,
} from '../core/timer/commands.js';
import { buildBlockedArchiveComment } from '../core/timer/archive-comment.js';
import { getActiveSession as getActiveTimerSession } from '../core/timer/store.js';
import { RuntimeStatusCommand } from '../core/runtime/status.js';
import { RuntimeExplainCommand } from '../core/runtime/explain.js';
import { SessionManager } from '../core/runtime/session/SessionManager.js';
import { AgentOrchestrator } from '../core/runtime/orchestration/AgentOrchestrator.js';
import { ApprovalManager } from '../core/runtime/approvals/ApprovalManager.js';
import { formatTicketSummary, listAssignedTickets } from '../core/timer/tickets.js';
import {
  statusCommand,
  instructionsCommand,
  applyInstructionsCommand,
  templatesCommand,
  schemasCommand,
  newChangeCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type InstructionsOptions,
  type TemplatesOptions,
  type SchemasOptions,
  type NewChangeOptions,
} from '../commands/workflow/index.js';
import { maybeShowTelemetryNotice, trackCommand, shutdown } from '../telemetry/index.js';

const program = new Command();
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');
const invokedName = path.basename(process.argv[1] || 'osj');
const cliName = invokedName === 'openspec.js' ? 'osj' : invokedName;
const runtimeStatusCommand = new RuntimeStatusCommand();
const runtimeExplainCommand = new RuntimeExplainCommand();
const sessionManager = new SessionManager();
const agentOrchestrator = new AgentOrchestrator();
const approvalManager = new ApprovalManager();

program.name(cliName);

interface TicketPickerOptions {
  project?: string;
  allProjects?: boolean;
  limit?: string | number;
  jql?: string;
}

function parsePositiveInteger(value: string | number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, got: ${value}`);
  }
  return parsed;
}

async function pickJiraIssue(options: TicketPickerOptions): Promise<string> {
  const tickets = await listAssignedTickets({
    project: options.project,
    allProjects: options.allProjects,
    limit: parsePositiveInteger(options.limit, 20),
    jql: options.jql,
  });

  if (tickets.length === 0) {
    throw new Error('No assigned Jira tickets found for the current filters.');
  }

  return select({
    message: 'Choose a Jira ticket',
    choices: tickets.map((ticket) => ({
      name: formatTicketSummary(ticket),
      value: ticket.key,
    })),
  });
}

/**
 * Get the full command path for nested commands.
 * For example: 'change show' -> 'change:show'
 */
function getCommandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    // Skip the root 'openspec' command
    if (name && name !== 'openspec') {
      names.unshift(name);
    }
    current = current.parent;
  }

  return names.join(':') || 'openspec';
}

function printAgentExecutionSummary(summary: { agent: string; status: string; recommended_next_action: string; artifact_refs: string[] }): void {
  console.log(`Agent: ${summary.agent}`);
  console.log(`Status: ${summary.status}`);
  console.log(`Next action: ${summary.recommended_next_action}`);
  if (summary.artifact_refs.length > 0) {
    console.log('Artifacts:');
    for (const ref of summary.artifact_refs) {
      console.log(`- ${ref}`);
    }
  }
}

function printApproval(approval: {
  approval_id: string;
  scope: string;
  status: string;
  reason: string;
  change_name?: string;
  resolved_at?: string | null;
  resolution_reason?: string;
}): void {
  console.log(`Approval: ${approval.approval_id}`);
  console.log(`Scope: ${approval.scope}`);
  console.log(`Status: ${approval.status}`);
  if (approval.change_name) {
    console.log(`Change: ${approval.change_name}`);
  }
  console.log(`Reason: ${approval.reason}`);
  if (approval.resolved_at) {
    console.log(`Resolved at: ${approval.resolved_at}`);
  }
  if (approval.resolution_reason) {
    console.log(`Resolution reason: ${approval.resolution_reason}`);
  }
}

program
  .name(cliName)
  .description('AI-native system for spec-driven development')
  .version(version);

// Global options
program.option('--no-color', 'Disable color output');

// Apply global flags and telemetry before any command runs
// Note: preAction receives (thisCommand, actionCommand) where:
// - thisCommand: the command where hook was added (root program)
// - actionCommand: the command actually being executed (subcommand)
program.hook('preAction', async (thisCommand, actionCommand) => {
  const opts = thisCommand.opts();
  if (opts.color === false) {
    process.env.NO_COLOR = '1';
  }

  // Show first-run telemetry notice (if not seen)
  await maybeShowTelemetryNotice();

  // Track command execution (use actionCommand to get the actual subcommand)
  const commandPath = getCommandPath(actionCommand);
  await trackCommand(commandPath, version);
});

// Shutdown telemetry after command completes
program.hook('postAction', async () => {
  await shutdown();
});

const availableToolIds = AI_TOOLS.filter((tool) => tool.skillsDir).map((tool) => tool.value);
const toolsOptionDescription = `Configure AI tools non-interactively. Use "all", "none", or a comma-separated list of: ${availableToolIds.join(', ')}`;

program
  .command('init [path]')
  .description('Initialize OpenSpec in your project')
  .option('--tools <tools>', toolsOptionDescription)
  .option('--force', 'Auto-cleanup legacy files without prompting')
  .option('--profile <profile>', 'Override global config profile (core or custom)')
  .action(async (targetPath = '.', options?: { tools?: string; force?: boolean; profile?: string }) => {
    try {
      // Validate that the path is a valid directory
      const resolvedPath = path.resolve(targetPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path "${targetPath}" is not a directory`);
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, but we can create it
          console.log(`Directory "${targetPath}" doesn't exist, it will be created.`);
        } else if (error.message && error.message.includes('not a directory')) {
          throw error;
        } else {
          throw new Error(`Cannot access path "${targetPath}": ${error.message}`);
        }
      }

      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tools,
        force: options?.force,
        profile: options?.profile,
      });
      await initCommand.execute(targetPath);
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Hidden alias: 'experimental' -> 'init' for backwards compatibility
program
  .command('experimental', { hidden: true })
  .description('Alias for init (deprecated)')
  .option('--tool <tool-id>', 'Target AI tool (maps to --tools)')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options?: { tool?: string; noInteractive?: boolean }) => {
    try {
      console.log('Note: "openspec experimental" is deprecated. Use "openspec init" instead.');
      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tool,
        interactive: options?.noInteractive === true ? false : undefined,
      });
      await initCommand.execute('.');
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('update [path]')
  .description('Update OpenSpec instruction files')
  .option('--force', 'Force update even when tools are up to date')
  .action(async (targetPath = '.', options?: { force?: boolean }) => {
    try {
      const resolvedPath = path.resolve(targetPath);
      const updateCommand = new UpdateCommand({ force: options?.force });
      await updateCommand.execute(resolvedPath);
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List items (changes by default). Use --specs to list specs.')
  .option('--specs', 'List specs instead of changes')
  .option('--changes', 'List changes explicitly (default)')
  .option('--sort <order>', 'Sort order: "recent" (default) or "name"', 'recent')
  .option('--json', 'Output as JSON (for programmatic use)')
  .action(async (options?: { specs?: boolean; changes?: boolean; sort?: string; json?: boolean }) => {
    try {
      const listCommand = new ListCommand();
      const mode: 'changes' | 'specs' = options?.specs ? 'specs' : 'changes';
      const sort = options?.sort === 'name' ? 'name' : 'recent';
      await listCommand.execute('.', mode, { sort, json: options?.json });
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('view')
  .description('Display an interactive dashboard of specs and changes')
  .action(async () => {
    try {
      const viewCommand = new ViewCommand();
      await viewCommand.execute('.');
    } catch (error) {
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Change command with subcommands
const changeCmd = program
  .command('change')
  .description('Manage OpenSpec change proposals');

// Deprecation notice for noun-based commands
changeCmd.hook('preAction', () => {
  console.error('Warning: The "openspec change ..." commands are deprecated. Prefer verb-first commands (e.g., "openspec list", "openspec validate --changes").');
});

changeCmd
  .command('show [change-name]')
  .description('Show a change proposal in JSON or markdown format')
  .option('--json', 'Output as JSON')
  .option('--deltas-only', 'Show only deltas (JSON only)')
  .option('--requirements-only', 'Alias for --deltas-only (deprecated)')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (changeName?: string, options?: { json?: boolean; requirementsOnly?: boolean; deltasOnly?: boolean; noInteractive?: boolean }) => {
    try {
      const changeCommand = new ChangeCommand();
      await changeCommand.show(changeName, options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

changeCmd
  .command('list')
  .description('List all active changes (DEPRECATED: use "openspec list" instead)')
  .option('--json', 'Output as JSON')
  .option('--long', 'Show id and title with counts')
  .action(async (options?: { json?: boolean; long?: boolean }) => {
    try {
      console.error('Warning: "openspec change list" is deprecated. Use "openspec list".');
      const changeCommand = new ChangeCommand();
      await changeCommand.list(options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

changeCmd
  .command('validate [change-name]')
  .description('Validate a change proposal')
  .option('--strict', 'Enable strict validation mode')
  .option('--json', 'Output validation report as JSON')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (changeName?: string, options?: { strict?: boolean; json?: boolean; noInteractive?: boolean }) => {
    try {
      const changeCommand = new ChangeCommand();
      await changeCommand.validate(changeName, options);
      if (typeof process.exitCode === 'number' && process.exitCode !== 0) {
        process.exit(process.exitCode);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('purpose')
  .description('Start an OpenSpec work session for a Jira issue')
  .option('--jira <issue-key>', 'Jira issue key to track work against')
  .option('--pick', 'Pick one of your assigned Jira tickets interactively')
  .option('--project <project-key>', 'Project key to filter tickets when using --pick')
  .option('--all-projects', 'Ignore jira.default_project when using --pick')
  .option('--limit <n>', 'Maximum tickets to show when using --pick', '20')
  .option('--jql <query>', 'Custom JQL for --pick')
  .option('--import-ticket', 'Import Jira ticket summary, status, assignee, description, and URL into the timer session')
  .option('--create-change', 'Create an OpenSpec change from the imported Jira ticket description')
  .action(async (options: { jira?: string; pick?: boolean; project?: string; allProjects?: boolean; limit?: string; jql?: string; importTicket?: boolean; createChange?: boolean }) => {
    try {
      const issueKey = options.pick
        ? await pickJiraIssue(options)
        : options.jira;
      if (!issueKey) {
        throw new Error("Missing Jira issue key. Use '--jira PROJ-123' or '--pick'.");
      }
      await startTimerSession(issueKey, {
        importTicket: options.importTicket,
        createChange: options.createChange,
      });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('tickets')
  .description('List Jira tickets assigned to the configured user')
  .option('--project <project-key>', 'Project key to filter tickets')
  .option('--all-projects', 'Ignore jira.default_project')
  .option('--limit <n>', 'Maximum tickets to show', '20')
  .option('--jql <query>', 'Custom JQL query')
  .option('--json', 'Output tickets as JSON')
  .action(async (options: { project?: string; allProjects?: boolean; limit?: string; jql?: string; json?: boolean }) => {
    try {
      const tickets = await listAssignedTickets({
        project: options.project,
        allProjects: options.allProjects,
        limit: parsePositiveInteger(options.limit, 20),
        jql: options.jql,
      });

      if (options.json) {
        console.log(JSON.stringify(tickets, null, 2));
        return;
      }

      if (tickets.length === 0) {
        console.log('No assigned Jira tickets found.');
        return;
      }

      for (const ticket of tickets) {
        console.log(formatTicketSummary(ticket));
        console.log(`  ${ticket.url}`);
      }
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

const timerCmd = program
  .command('timer')
  .description('Manage the OpenSpec work timer');

const runtimeCmd = program
  .command('runtime')
  .description('Inspect agentic runtime state');

const agentCmd = program
  .command('agent')
  .description('Run runtime agents');

const orchestrateCmd = program
  .command('orchestrate')
  .description('Run agentic orchestration steps');

const approvalCmd = program
  .command('approval')
  .description('Inspect and resolve runtime approvals');

runtimeCmd
  .command('status')
  .description('Show the current or latest OpenSpec runtime state')
  .option('--json', 'Output runtime state as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      await runtimeStatusCommand.execute(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

runtimeCmd
  .command('explain')
  .description('Explain the current or latest OpenSpec runtime state')
  .option('--json', 'Output the explanation as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      await runtimeExplainCommand.execute(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

agentCmd
  .command('run <agent>')
  .description('Run a runtime agent: context, spec, planning, implementation, critic, validation, delivery')
  .action(async (agent: string) => {
    try {
      const normalized = agent.trim().toLowerCase();
      const map = {
        context: 'context_agent',
        spec: 'spec_agent',
        planning: 'planning_agent',
        implementation: 'implementation_agent',
        critic: 'critic_agent',
        validation: 'validation_agent',
        delivery: 'delivery_agent',
      } as const;
      if (!(normalized in map)) {
        throw new Error(`Unknown agent '${agent}'. Use one of: context, spec, planning, implementation, critic, validation, delivery.`);
      }
      const summary = await agentOrchestrator.runAgent(map[normalized as keyof typeof map]);
      printAgentExecutionSummary(summary);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

orchestrateCmd
  .option('--from-session', 'Run orchestration using the active runtime session')
  .option('--until <stage>', 'Run until stage: context, spec, planning, implementation, critic, validation, delivery', 'planning')
  .action(async (options: { fromSession?: boolean; until?: string }) => {
    try {
      const until = (options.until ?? 'planning').trim().toLowerCase();
      if (
        until !== 'context'
        && until !== 'spec'
        && until !== 'planning'
        && until !== 'implementation'
        && until !== 'critic'
        && until !== 'validation'
        && until !== 'delivery'
      ) {
        throw new Error(`Unsupported --until value '${options.until}'. Use context, spec, planning, implementation, critic, validation, or delivery.`);
      }
      const results = await agentOrchestrator.orchestrateUntil(until);
      for (const summary of results) {
        printAgentExecutionSummary(summary);
      }
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

approvalCmd
  .command('show')
  .description('Show approvals for the current or latest runtime ticket')
  .option('--json', 'Output approvals as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const snapshot = await sessionManager.getCurrentRuntimeSnapshot();
      if (!snapshot) {
        console.log('No OpenSpec runtime state found.');
        return;
      }

      const approvals = await approvalManager.listApprovalsForTicket(snapshot.ticket.ticket_key);
      if (options.json) {
        console.log(JSON.stringify(approvals, null, 2));
        return;
      }

      if (approvals.length === 0) {
        console.log('No approvals found for the current runtime ticket.');
        return;
      }

      for (const approval of approvals) {
        printApproval(approval);
      }
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

approvalCmd
  .command('accept <approval-id>')
  .description('Approve a pending runtime approval')
  .option('--reason <text>', 'Optional approval note')
  .action(async (approvalId: string, options: { reason?: string }) => {
    try {
      const approval = await approvalManager.resolveApproval(approvalId, 'APPROVED', options.reason);
      printApproval(approval);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

approvalCmd
  .command('reject <approval-id>')
  .description('Reject a pending runtime approval')
  .requiredOption('--reason <text>', 'Reason for rejecting the approval')
  .action(async (approvalId: string, options: { reason: string }) => {
    try {
      const approval = await approvalManager.resolveApproval(approvalId, 'REJECTED', options.reason);
      printApproval(approval);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('start')
  .description('Start a manual human timer for a Jira issue')
  .requiredOption('--jira <issue-key>', 'Jira issue key to track work against')
  .option('--kind <kind>', 'Work kind: implementation, spec, review, bugfix, rework, testing, other', 'implementation')
  .option('--description <text>', 'Description for this manual human block')
  .option('--import-ticket', 'Import Jira ticket context into the timer session')
  .action(async (options: { jira: string; kind: string; description?: string; importTicket?: boolean }) => {
    try {
      await startManualHumanTimer(options.jira, {
        kind: validateTimerWorkKind(options.kind),
        description: options.description,
        importTicket: options.importTicket,
      });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('status')
  .description('Show the active OpenSpec work timer')
  .option('--blocks', 'Show closed granular time blocks')
  .action(async (options: { blocks?: boolean }) => {
    try {
      await timerStatus({ blocks: options.blocks });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('report')
  .description('Preview the Jira worklogs that archive would create')
  .action(async () => {
    try {
      await timerReport();
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('switch')
  .description('Switch the active OpenSpec timer to a different work block')
  .requiredOption('--mode <mode>', 'Actor mode: human, ai_autonomous, human_agent_interaction')
  .requiredOption('--kind <kind>', 'Work kind: implementation, spec, review, bugfix, rework, testing, other')
  .option('--description <text>', 'Description for this block')
  .action(async (options: { mode: string; kind: string; description?: string }) => {
    try {
      await switchTimerBlock({
        mode: validateTimerActorMode(options.mode),
        kind: validateTimerWorkKind(options.kind),
        description: options.description,
      });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('bugfix')
  .description('Switch the active session to human bugfix work, or start one with --jira')
  .option('--jira <issue-key>', 'Jira issue key used when no timer session is active')
  .option('--description <text>', 'Bugfix block description', 'Fix implementation or OpenSpec validation issues')
  .action(async (options: { jira?: string; description?: string }) => {
    try {
      const timerSession = await getActiveTimerSession();
      if (timerSession?.status === 'running') {
        await switchTimerBlock({
          mode: 'human',
          kind: 'bugfix',
          description: options.description,
        });
        return;
      }

      if (timerSession?.status === 'paused') {
        throw new Error("OpenSpec session is paused.\nUse 'openspec timer resume' before switching to bugfix work.");
      }

      if (!options.jira) {
        throw new Error("No active OpenSpec session found.\nUse 'openspec timer bugfix --jira PROJ-123 --description \"Fix validation errors\"' to start a manual bugfix timer.");
      }

      await startManualHumanTimer(options.jira, {
        kind: 'bugfix',
        description: options.description,
      });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('pause')
  .description('Pause the active OpenSpec work timer')
  .action(async () => {
    try {
      await pauseTimer();
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('resume')
  .description('Resume a paused OpenSpec work timer')
  .action(async () => {
    try {
      await resumeTimer();
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

timerCmd
  .command('cancel')
  .description('Cancel the active OpenSpec work timer without creating a Jira worklog')
  .action(async () => {
    try {
      await cancelTimer();
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('archive [change-name]')
  .description('Archive a completed change and sync an active Jira worklog session')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--skip-specs', 'Skip spec update operations (useful for infrastructure, tooling, or doc-only changes)')
  .option('--no-validate', 'Skip validation (not recommended, requires confirmation)')
  .option('--comment <text>', 'Comment for the Jira worklog')
  .option('--retry', 'Retry a pending Jira worklog sync')
  .option('--dry-run', 'Preview Jira worklogs without archiving OpenSpec or writing to Jira')
  .action(async (changeName?: string, options?: { yes?: boolean; skipSpecs?: boolean; noValidate?: boolean; validate?: boolean; comment?: string; retry?: boolean; dryRun?: boolean }) => {
    let archiveAutoBlockStarted = false;
    try {
      const timerSession = await getActiveTimerSession();
      const routing = await resolveArchiveRouting({
        projectRoot: process.cwd(),
        explicitChangeName: changeName,
        timerSession,
      });
      let targetChangeName = routing.targetChangeName;
      if (routing.warning) {
        console.log(routing.warning);
      }
      if (options?.dryRun) {
        await timerReport({ dryRun: true, changeName: targetChangeName, comment: options.comment });
        return;
      }
      if (options?.retry || timerSession?.status === 'sync_pending' || routing.fallBackToTimerArchive) {
        await archiveTimer({ comment: options?.comment, retry: options?.retry });
        return;
      }

      if (timerSession && targetChangeName) {
        archiveAutoBlockStarted = await switchToAutomaticBlock(
          'ai_autonomous',
          'review',
          'OpenSpec archive validation and spec application'
        );
      }

      const archiveCommand = new ArchiveCommand();
      const archiveResult = await archiveCommand.execute(targetChangeName, options);

      if (archiveResult.changeName) {
        if (timerSession) {
          await sessionManager.recordArchiveOutcome({
            ticketKey: timerSession.jira_issue_key,
            changeName: archiveResult.changeName,
            archived: archiveResult.archived,
            archiveName: archiveResult.archiveName,
            reason: archiveResult.reason,
          });
        } else {
          await sessionManager.recordArchiveOutcomeForChange({
            changeName: archiveResult.changeName,
            archived: archiveResult.archived,
            archiveName: archiveResult.archiveName,
            reason: archiveResult.reason,
          });
        }
      }

      if (!archiveResult.archived) {
        if (timerSession) {
          console.log('OpenSpec change was not archived; Jira worklog will still be created for the elapsed developer time.');
          const closedSession = await archiveTimer({ comment: options?.comment, addJiraArchiveComment: false });
          const note = buildBlockedArchiveComment({
            issueKey: timerSession.jira_issue_key,
            changeName: archiveResult.changeName,
            reason: archiveResult.reason,
            diagnostics: archiveResult.diagnostics,
            worklogId: closedSession.jira_worklog_id,
          });

          try {
            await addJiraArchiveComment(timerSession.jira_issue_key, note);
            console.log('Jira archive comment created successfully');
          } catch (commentError) {
            console.log(`Warning: OpenSpec archive was blocked, and Jira comment could not be added: ${(commentError as Error).message}`);
          }
          console.log(`Suggested next step: osj timer bugfix --jira ${timerSession.jira_issue_key} --description "Fix OpenSpec archive validation errors"`);
        }
        return;
      }

      if (timerSession) {
        await archiveTimer({ comment: options?.comment });
      }
    } catch (error) {
      if (archiveAutoBlockStarted) {
        try {
          await switchToAutomaticBlock('human', 'bugfix', 'Fix failed OpenSpec archive command');
          console.log('Timer switched to human / bugfix.');
          console.log('Suggested command: osj timer bugfix --description "Fix failed OpenSpec archive command"');
        } catch {
          // Keep the original archive error visible.
        }
      }
      console.log(); // Empty line for spacing
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

registerSpecCommand(program);
registerConfigCommand(program);
registerSchemaCommand(program);
registerHlpCommand(program);

// Top-level validate command
program
  .command('validate [item-name]')
  .description('Validate changes and specs')
  .option('--all', 'Validate all changes and specs')
  .option('--changes', 'Validate all changes')
  .option('--specs', 'Validate all specs')
  .option('--type <type>', 'Specify item type when ambiguous: change|spec')
  .option('--strict', 'Enable strict validation mode')
  .option('--json', 'Output validation results as JSON')
  .option('--concurrency <n>', 'Max concurrent validations (defaults to env OPENSPEC_CONCURRENCY or 6)')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (itemName?: string, options?: { all?: boolean; changes?: boolean; specs?: boolean; type?: string; strict?: boolean; json?: boolean; noInteractive?: boolean; concurrency?: string }) => {
    try {
      const validateCommand = new ValidateCommand();
      await validateCommand.execute(itemName, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Top-level show command
program
  .command('show [item-name]')
  .description('Show a change or spec')
  .option('--json', 'Output as JSON')
  .option('--type <type>', 'Specify item type when ambiguous: change|spec')
  .option('--no-interactive', 'Disable interactive prompts')
  // change-only flags
  .option('--deltas-only', 'Show only deltas (JSON only, change)')
  .option('--requirements-only', 'Alias for --deltas-only (deprecated, change)')
  // spec-only flags
  .option('--requirements', 'JSON only: Show only requirements (exclude scenarios)')
  .option('--no-scenarios', 'JSON only: Exclude scenario content')
  .option('-r, --requirement <id>', 'JSON only: Show specific requirement by ID (1-based)')
  // allow unknown options to pass-through to underlying command implementation
  .allowUnknownOption(true)
  .action(async (itemName?: string, options?: { json?: boolean; type?: string; noInteractive?: boolean; [k: string]: any }) => {
    try {
      const showCommand = new ShowCommand();
      await showCommand.execute(itemName, options ?? {});
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Feedback command
program
  .command('feedback <message>')
  .description('Submit feedback about OpenSpec')
  .option('--body <text>', 'Detailed description for the feedback')
  .action(async (message: string, options?: { body?: string }) => {
    try {
      const feedbackCommand = new FeedbackCommand();
      await feedbackCommand.execute(message, options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Completion command with subcommands
const completionCmd = program
  .command('completion')
  .description('Manage shell completions for OpenSpec CLI');

completionCmd
  .command('generate [shell]')
  .description('Generate completion script for a shell (outputs to stdout)')
  .action(async (shell?: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.generate({ shell });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

completionCmd
  .command('install [shell]')
  .description('Install completion script for a shell')
  .option('--verbose', 'Show detailed installation output')
  .action(async (shell?: string, options?: { verbose?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.install({ shell, verbose: options?.verbose });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

completionCmd
  .command('uninstall [shell]')
  .description('Uninstall completion script for a shell')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (shell?: string, options?: { yes?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.uninstall({ shell, yes: options?.yes });
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Hidden command for machine-readable completion data
program
  .command('__complete <type>', { hidden: true })
  .description('Output completion data in machine-readable format (internal use)')
  .action(async (type: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.complete({ type });
    } catch (error) {
      // Silently fail for graceful shell completion experience
      process.exitCode = 1;
    }
  });

// ═══════════════════════════════════════════════════════════
// Workflow Commands (formerly experimental)
// ═══════════════════════════════════════════════════════════

// Status command
program
  .command('status')
  .description('Display artifact completion status for a change')
  .option('--change <id>', 'Change name to show status for')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .action(async (options: StatusOptions) => {
    try {
      await statusCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Instructions command
program
  .command('instructions [artifact]')
  .description('Output enriched instructions for creating an artifact or applying tasks')
  .option('--change <id>', 'Change name')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .action(async (artifactId: string | undefined, options: InstructionsOptions) => {
    try {
      // Special case: "apply" is not an artifact, but a command to get apply instructions
      if (artifactId === 'apply') {
        await applyInstructionsCommand(options);
      } else {
        await instructionsCommand(artifactId, options);
      }
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Templates command
program
  .command('templates')
  .description('Show resolved template paths for all artifacts in a schema')
  .option('--schema <name>', `Schema to use (default: ${DEFAULT_SCHEMA})`)
  .option('--json', 'Output as JSON mapping artifact IDs to template paths')
  .action(async (options: TemplatesOptions) => {
    try {
      await templatesCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Schemas command
program
  .command('schemas')
  .description('List available workflow schemas with descriptions')
  .option('--json', 'Output as JSON (for agent use)')
  .action(async (options: SchemasOptions) => {
    try {
      await schemasCommand(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// New command group with change subcommand
const newCmd = program.command('new').description('Create new items');

newCmd
  .command('change [name]')
  .description('Create a new change directory')
  .option('--description <text>', 'Description to add to README.md')
  .option('--schema <name>', `Workflow schema to use (default: ${DEFAULT_SCHEMA})`)
  .option('--from-ticket <issue-key>', 'Create a change from a Jira ticket')
  .option('--from-session', 'Create a change from the Jira ticket in the active timer session')
  .action(async (name: string, options: NewChangeOptions) => {
    let newChangeAutoBlockStarted = false;
    try {
      const timerSession = await getActiveTimerSession();
      if (timerSession?.status === 'running') {
        newChangeAutoBlockStarted = await switchToAutomaticBlock(
          'ai_autonomous',
          'spec',
          options.fromTicket || options.fromSession
            ? 'OpenSpec generated change artifacts from Jira ticket'
            : 'OpenSpec generated change scaffold'
        );
      }
      await newChangeCommand(name, options);
      if (newChangeAutoBlockStarted) {
        await switchToDefaultHumanWork();
      }
    } catch (error) {
      if (newChangeAutoBlockStarted) {
        try {
          await switchToAutomaticBlock('human', 'bugfix', 'Fix failed OpenSpec change generation');
          console.log('Timer switched to human / bugfix.');
          console.log('Suggested command: osj timer bugfix --description "Fix failed OpenSpec change generation"');
        } catch {
          // Keep the original new change error visible.
        }
      }
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
