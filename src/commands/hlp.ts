import type { Command } from 'commander';

export interface HlpOptions {
  short?: boolean;
  demo?: boolean;
}

const FULL_HELP = `OpenSpec Jira/Tempo Help

1. Configure Jira once per machine

   openspec-jira config set jira.base_url https://your-company.atlassian.net
   openspec-jira config set jira.email dev@example.com
   openspec-jira config set jira.api_token YOUR_ATLASSIAN_API_TOKEN
   openspec-jira config set jira.default_project PROJ
   openspec-jira config show

2. Find your next ticket

   openspec-jira tickets
      List your assigned Jira tickets.

   openspec-jira tickets --all-projects
      List assigned tickets without filtering by jira.default_project.

   openspec-jira tickets --jql 'assignee = currentUser() AND status = "In Progress"'
      List tickets using custom JQL.

3. Start work

   openspec-jira purpose --pick --import-ticket
      Pick an assigned Jira ticket and start a timer with Jira context.

   openspec-jira purpose --pick --import-ticket --create-change
      Pick a ticket, start a timer, import Jira context, and create OpenSpec artifacts.

   openspec-jira purpose --jira PROJ-123 --import-ticket
      Start a timer for a known ticket without creating new artifacts.

   openspec-jira purpose --jira PROJ-123 --import-ticket --create-change
      Start a timer for a known ticket and create proposal.md, tasks.md, jira-ticket.md, and spec.md.

4. Check progress before archive

   openspec-jira timer status
      Show the active timer session.

   openspec-jira timer status --blocks
      Show the active timer plus closed time blocks.

   openspec-jira timer report
      Preview the Jira worklogs that would be created from the active timer.

   openspec-jira archive <change-name> --dry-run --comment "Implementation session"
      Preview archive worklogs without changing OpenSpec or Jira.

5. Control time blocks

   openspec-jira timer pause
      Pause the active timer.

   openspec-jira timer resume
      Resume the paused timer.

   openspec-jira timer switch --mode human --kind bugfix --description "Fix validation errors"
      Switch the current block to a specific type of work.

   openspec-jira timer bugfix --description "Fix OpenSpec validation errors"
      Shortcut for switching the active timer to human / bugfix.

   openspec-jira timer start --jira PROJ-123 --description "Manual IDE work"
      Start a manual human timer when work continues outside purpose/create-change.

6. Archive and sync time

   openspec-jira validate <change-name> --type change
      Validate the OpenSpec change before archiving.

   openspec-jira archive <change-name> --yes --comment "Implementation session"
      Archive the OpenSpec change, create Jira worklogs, add Jira summary comment, and close the timer.

   openspec-jira archive --retry
      Retry a failed Jira worklog sync.

7. Cancel if needed

   openspec-jira timer cancel
      Cancel the active timer without creating Jira worklogs.

Typical happy path:

   openspec-jira tickets
   openspec-jira purpose --pick --import-ticket --create-change
   openspec-jira timer status --blocks
   openspec-jira timer report
   openspec-jira validate <change-name> --type change
   openspec-jira archive <change-name> --dry-run --comment "Implementation session"
   openspec-jira archive <change-name> --yes --comment "Implementation session"

Notes:

   - Use --dry-run before archive when you want to inspect worklogs first.
   - Use timer bugfix when archive validation fails and you continue correcting the change.
   - Jira API tokens are stored in global OpenSpec config and are redacted by config show.`;

const SHORT_HELP = `OpenSpec Jira/Tempo Basic Flow

1. Configure
   openspec-jira config set jira.base_url https://your-company.atlassian.net
   openspec-jira config set jira.email dev@example.com
   openspec-jira config set jira.api_token YOUR_ATLASSIAN_API_TOKEN

2. Pick/start
   openspec-jira tickets
   openspec-jira purpose --pick --import-ticket --create-change

3. Work/check
   openspec-jira timer status --blocks
   openspec-jira timer report

4. Preview/archive
   openspec-jira archive <change-name> --dry-run --comment "Implementation session"
   openspec-jira archive <change-name> --yes --comment "Implementation session"`;

const DEMO_HELP = `OpenSpec Jira/Tempo Demo Flow

Run the sandbox demo:

   npm run demo:jira

The demo creates:

   demo-output/jira-happy-path/product-repo
   demo-output/jira-happy-path/mock-jira-worklogs.json
   demo-output/jira-happy-path/mock-jira-comments.json

Demo commands shown:

   openspec-jira tickets
   openspec-jira purpose --jira PROJ-123 --import-ticket --create-change
   openspec-jira timer report
   openspec-jira archive <change-name> --dry-run --comment "Demo implementation for PROJ-123"
   openspec-jira archive <change-name> --yes --comment "Demo implementation for PROJ-123"`;

export function getHlpText(options: HlpOptions = {}): string {
  if (options.demo) {
    return DEMO_HELP;
  }
  if (options.short) {
    return SHORT_HELP;
  }
  return FULL_HELP;
}

export function registerHlpCommand(program: Command): void {
  program
    .command('hlp')
    .description('Show the basic Jira/Tempo workflow commands')
    .option('--short', 'Show the shortest daily workflow')
    .option('--demo', 'Show the sandbox demo workflow')
    .action((options: HlpOptions) => {
      console.log(getHlpText(options));
    });
}
