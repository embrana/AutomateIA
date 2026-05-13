import type { Command } from 'commander';

export interface HlpOptions {
  short?: boolean;
  demo?: boolean;
}

const FULL_HELP = `OpenSpec Jira/Tempo Help

1. Configure Jira once per machine

   osj config set jira.base_url https://your-company.atlassian.net
   osj config set jira.email dev@example.com
   osj config set jira.api_token YOUR_ATLASSIAN_API_TOKEN
   osj config set jira.default_project PROJ
   osj config show

2. Find your next ticket

   osj tickets
      List your assigned Jira tickets.

   osj tickets --all-projects
      List assigned tickets without filtering by jira.default_project.

   osj tickets --jql 'assignee = currentUser() AND status = "In Progress"'
      List tickets using custom JQL.

3. Start work

   osj purpose --pick --import-ticket
      Pick an assigned Jira ticket and start a timer with Jira context.

   osj purpose --pick --import-ticket --create-change
      Pick a ticket, start a timer, import Jira context, and create OpenSpec artifacts.

   osj purpose --jira PROJ-123 --import-ticket
      Start a timer for a known ticket without creating new artifacts.

   osj purpose --jira PROJ-123 --import-ticket --create-change
      Start a timer for a known ticket and create proposal.md, tasks.md, jira-ticket.md, and spec.md.

   osj new change --from-session
      Create OpenSpec artifacts from the Jira ticket in the active timer session.

4. Check progress before archive

   osj ticket show
      Show the Jira ticket context imported into the active timer session.

   osj timer status
      Show the active timer session.

   osj timer status --blocks
      Show the active timer plus closed time blocks.

   osj timer report
      Preview the Jira worklogs that would be created from the active timer.

   osj archive <change-name> --dry-run --comment "Implementation session"
      Preview archive worklogs without changing OpenSpec or Jira.

5. Control time blocks

   osj timer pause
      Pause the active timer.

   osj timer resume
      Resume the paused timer.

   osj timer switch --mode human --kind bugfix --description "Fix validation errors"
      Switch the current block to a specific type of work.

   osj timer bugfix --description "Fix OpenSpec validation errors"
      Shortcut for switching the active timer to human / bugfix.

   osj timer start --jira PROJ-123 --description "Manual IDE work"
      Start a manual human timer when work continues outside purpose/create-change.

6. Archive and sync time

   osj validate <change-name> --type change
      Validate the OpenSpec change before archiving.

   osj archive <change-name> --yes --comment "Implementation session"
      Archive the OpenSpec change, create Jira worklogs, add Jira summary comment, and close the timer.

   osj archive --retry
      Retry a failed Jira worklog sync.

7. Cancel if needed

   osj timer cancel
      Cancel the active timer without creating Jira worklogs.

Typical happy path:

   osj tickets
   osj purpose --pick --import-ticket --create-change
   osj timer status --blocks
   osj timer report
   osj validate <change-name> --type change
   osj archive <change-name> --dry-run --comment "Implementation session"
   osj archive <change-name> --yes --comment "Implementation session"

Notes:

   - Use --dry-run before archive when you want to inspect worklogs first.
   - Use timer bugfix when archive validation fails and you continue correcting the change.
   - Jira API tokens are stored in global OpenSpec config and are redacted by config show.`;

const SHORT_HELP = `OpenSpec Jira/Tempo Basic Flow

1. Configure
   osj config set jira.base_url https://your-company.atlassian.net
   osj config set jira.email dev@example.com
   osj config set jira.api_token YOUR_ATLASSIAN_API_TOKEN

2. Pick/start
   osj tickets
   osj purpose --pick --import-ticket --create-change

3. Work/check
   osj ticket show
   osj timer status --blocks
   osj timer report

4. Preview/archive
   osj archive <change-name> --dry-run --comment "Implementation session"
   osj archive <change-name> --yes --comment "Implementation session"`;

const DEMO_HELP = `OpenSpec Jira/Tempo Demo Flow

Run the sandbox demo:

   npm run demo:jira

The demo creates:

   demo-output/jira-happy-path/product-repo
   demo-output/jira-happy-path/mock-jira-worklogs.json
   demo-output/jira-happy-path/mock-jira-comments.json

Demo commands shown:

   osj tickets
   osj purpose --jira PROJ-123 --import-ticket --create-change
   osj timer report
   osj archive <change-name> --dry-run --comment "Demo implementation for PROJ-123"
   osj archive <change-name> --yes --comment "Demo implementation for PROJ-123"`;

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
