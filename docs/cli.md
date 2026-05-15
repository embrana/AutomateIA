# CLI Reference

The OpenSpec CLI (`openspec`) provides terminal commands for project setup, validation, status inspection, and management. These commands complement the AI slash commands (like `/opsx:propose`, or `/opsx-propose` in Codex-style tools) documented in [Commands](commands.md).

> Note: this Jira/Tempo fork installs a separate binary named `osj` so it can coexist with the official `openspec` package. When using this fork, run the same commands with `osj` in place of `openspec`.

## Summary

| Category | Commands | Purpose |
|----------|----------|---------|
| **Setup** | `init`, `update` | Initialize and update OpenSpec in your project |
| **Browsing** | `list`, `view`, `show` | Explore changes and specs |
| **Validation** | `validate` | Check changes and specs for issues |
| **Lifecycle** | `archive` | Finalize completed changes |
| **Timer** | `purpose`, `timer` | Track local work time and sync Jira worklogs |
| **OPSX Session Helpers** | `opsx track`, `opsx create-change` | Native session-aware tracking for `/opsx:explore` and `/opsx:propose` |
| **Monitoring** | `monitoring export`, `monitoring build-site`, `monitoring serve` | Export runtime metrics, generate a static dashboard, or serve a live monitoring site |
| **Workflow** | `status`, `instructions`, `templates`, `schemas` | Artifact-driven workflow support |
| **Schemas** | `schema init`, `schema fork`, `schema validate`, `schema which` | Create and manage custom workflows |
| **Config** | `config` | View and modify settings |
| **Utility** | `feedback`, `completion` | Feedback and shell integration |

---

## Human vs Agent Commands

Most CLI commands are designed for **human use** in a terminal. Some commands also support **agent/script use** via JSON output.

### Human-Only Commands

These commands are interactive and designed for terminal use:

| Command | Purpose |
|---------|---------|
| `openspec init` | Initialize project (interactive prompts) |
| `openspec view` | Interactive dashboard |
| `openspec config edit` | Open config in editor |
| `openspec feedback` | Submit feedback via GitHub |
| `openspec completion install` | Install shell completions |

### Agent-Compatible Commands

These commands support `--json` output for programmatic use by AI agents and scripts:

| Command | Human Use | Agent Use |
|---------|-----------|-----------|
| `openspec list` | Browse changes/specs | `--json` for structured data |
| `openspec show <item>` | Read content | `--json` for parsing |
| `openspec validate` | Check for issues | `--all --json` for bulk validation |
| `openspec status` | See artifact progress | `--json` for structured status |
| `openspec instructions` | Get next steps | `--json` for agent instructions |
| `openspec templates` | Find template paths | `--json` for path resolution |
| `openspec schemas` | List available schemas | `--json` for schema discovery |

---

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--version`, `-V` | Show version number |
| `--no-color` | Disable color output |
| `--help`, `-h` | Display help for command |

---

## Setup Commands

### `openspec init`

Initialize OpenSpec in your project. Creates the folder structure and configures AI tool integrations.

Default behavior uses global config defaults: profile `core`, delivery `both`, workflows `propose, explore, apply, archive`.

```
openspec init [path] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | No | Target directory (default: current directory) |

**Options:**

| Option | Description |
|--------|-------------|
| `--tools <list>` | Configure AI tools non-interactively. Use `all`, `none`, or comma-separated list |
| `--force` | Auto-cleanup legacy files without prompting |
| `--profile <profile>` | Override global profile for this init run (`core` or `custom`) |

`--profile custom` uses whatever workflows are currently selected in global config (`openspec config profile`).

**Supported tool IDs (`--tools`):** `amazon-q`, `antigravity`, `auggie`, `claude`, `cline`, `codex`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `iflow`, `kilocode`, `kiro`, `opencode`, `pi`, `qoder`, `qwen`, `roocode`, `trae`, `windsurf`

**Examples:**

```bash
# Interactive initialization
openspec init

# Initialize in a specific directory
openspec init ./my-project

# Non-interactive: configure for Claude and Cursor
openspec init --tools claude,cursor

# Configure for all supported tools
openspec init --tools all

# Override profile for this run
openspec init --profile core

# Skip prompts and auto-cleanup legacy files
openspec init --force
```

**What it creates:**

```
openspec/
├── specs/              # Your specifications (source of truth)
├── changes/            # Proposed changes
└── config.yaml         # Project configuration

.claude/skills/         # Claude Code skills (if claude selected)
.cursor/skills/         # Cursor skills (if cursor selected)
.cursor/commands/       # Cursor OPSX commands (if delivery includes commands)
... (other tool configs)
```

For Codex specifically, `osj init` / `osj update` now install:

- the normal `opsx-*` workflow prompts
- companion `osj-*` prompts for common session work, including:
  - `/osj-purpose-start`
  - `/osj-ticket-show`
  - `/osj-tickets`
  - `/osj-runtime-status`
  - `/osj-runtime-explain`
  - `/osj-timer-report`
  - `/osj-timer-cancel`
  - `/osj-archive-retry`
  - `/osj-approval-show`

The generated `/opsx-explore` and `/opsx-propose` prompts also use the native `osj opsx ...` helpers when an active Jira-backed session exists.

---

### `openspec update`

Update OpenSpec instruction files after upgrading the CLI. Re-generates AI tool configuration files using your current global profile, selected workflows, and delivery mode.

```
openspec update [path] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | No | Target directory (default: current directory) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Force update even when files are up to date |

**Example:**

```bash
# Update instruction files after npm upgrade
npm update @fission-ai/openspec
openspec update
```

---

## Browsing Commands

### `openspec list`

List changes or specs in your project.

```
openspec list [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--specs` | List specs instead of changes |
| `--changes` | List changes (default) |
| `--sort <order>` | Sort by `recent` (default) or `name` |
| `--json` | Output as JSON |

**Examples:**

```bash
# List all active changes
openspec list

# List all specs
openspec list --specs

# JSON output for scripts
openspec list --json
```

**Output (text):**

```
Active changes:
  add-dark-mode     UI theme switching support
  fix-login-bug     Session timeout handling
```

---

### `openspec view`

Display an interactive dashboard for exploring specs and changes.

```
openspec view
```

Opens a terminal-based interface for navigating your project's specifications and changes.

---

### `openspec show`

Display details of a change or spec.

```
openspec show [item-name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `item-name` | No | Name of change or spec (prompts if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--type <type>` | Specify type: `change` or `spec` (auto-detected if unambiguous) |
| `--json` | Output as JSON |
| `--no-interactive` | Disable prompts |

**Change-specific options:**

| Option | Description |
|--------|-------------|
| `--deltas-only` | Show only delta specs (JSON mode) |

**Spec-specific options:**

| Option | Description |
|--------|-------------|
| `--requirements` | Show only requirements, exclude scenarios (JSON mode) |
| `--no-scenarios` | Exclude scenario content (JSON mode) |
| `-r, --requirement <id>` | Show specific requirement by 1-based index (JSON mode) |

**Examples:**

```bash
# Interactive selection
openspec show

# Show a specific change
openspec show add-dark-mode

# Show a specific spec
openspec show auth --type spec

# JSON output for parsing
openspec show add-dark-mode --json
```

---

## Validation Commands

### `openspec validate`

Validate changes and specs for structural issues.

```
openspec validate [item-name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `item-name` | No | Specific item to validate (prompts if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--all` | Validate all changes and specs |
| `--changes` | Validate all changes |
| `--specs` | Validate all specs |
| `--type <type>` | Specify type when name is ambiguous: `change` or `spec` |
| `--strict` | Enable strict validation mode |
| `--json` | Output as JSON |
| `--concurrency <n>` | Max parallel validations (default: 6, or `OPENSPEC_CONCURRENCY` env) |
| `--no-interactive` | Disable prompts |

**Examples:**

```bash
# Interactive validation
openspec validate

# Validate a specific change
openspec validate add-dark-mode

# Validate all changes
openspec validate --changes

# Validate everything with JSON output (for CI/scripts)
openspec validate --all --json

# Strict validation with increased parallelism
openspec validate --all --strict --concurrency 12
```

**Output (text):**

```
Validating add-dark-mode...
  ✓ proposal.md valid
  ✓ specs/ui/spec.md valid
  ⚠ design.md: missing "Technical Approach" section

1 warning found
```

**Output (JSON):**

```json
{
  "version": "1.0.0",
  "results": {
    "changes": [
      {
        "name": "add-dark-mode",
        "valid": true,
        "warnings": ["design.md: missing 'Technical Approach' section"]
      }
    ]
  },
  "summary": {
    "total": 1,
    "valid": 1,
    "invalid": 0
  }
}
```

---

## Work Timer Commands

These commands track one local work session at a time and sync the elapsed time to Jira Cloud worklogs. Timer state is stored in `.openspec/session.json`; completed sessions are saved under `.openspec/sessions/`.

### `openspec purpose`

Start a work session for a Jira issue.

```
openspec purpose --jira <ISSUE-KEY> [--import-ticket] [--create-change]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--jira <issue-key>` | Jira issue key to track work against |
| `--import-ticket` | Import ticket key, summary, status, assignee, description text, and URL into the local timer session |
| `--create-change` | Create an OpenSpec change from the imported Jira ticket description |

**Example:**

```bash
openspec purpose --jira PROJ-123
openspec purpose --jira PROJ-123 --import-ticket
openspec purpose --jira PROJ-123 --import-ticket --create-change
```

When `--create-change` is used, OpenSpec creates:

```text
openspec/changes/<change-name>/
├── proposal.md
├── tasks.md
├── jira-ticket.md
└── specs/<change-name>/spec.md
```

The initial delta spec is built from the Jira description. If the description already contains OpenSpec delta sections such as `## ADDED Requirements`, OpenSpec writes it as-is. If the description contains structured SDD sections such as `## Acceptance Criteria`, `## Business Rules`, `## Domain / Data / Integration Contracts`, `## UX / Error States`, or `## Out of Scope`, OpenSpec creates a richer requirement and turns acceptance criteria headings like `### CA-1 — ...`, `### CA-1 - ...`, or `### CA-1: ...` into OpenSpec scenarios. The structured importer also accepts Spanish section aliases such as `## Contexto`, `## Objetivos`, `## Criterios de aceptación`, `## Reglas de negocio`, `## Estados de UX / Error`, `## Fuera de alcance`, and `## Trazabilidad`.

### `openspec ticket show`

Show the Jira ticket context imported into the active session.

```
openspec ticket show [--json]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--json` | Output imported ticket context as JSON |

**Examples:**

```bash
openspec ticket show
openspec ticket show --json
```

This command reads the imported Jira context from the active timer session. If the current session was not started with `--import-ticket`, it explains that no imported ticket context is available.

### `openspec timer`

Inspect or cancel the active work timer.

```
openspec timer <subcommand>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `status` | Show active timer status, Jira issue, and elapsed time |
| `cancel` | Cancel the active timer without creating a Jira worklog |

**Examples:**

```bash
openspec timer status
openspec timer cancel
```

### `openspec opsx`

Native OPSX session helpers used by the Jira/Tempo fork when `/opsx:explore` and `/opsx:propose` run against an active `osj` session.

```
openspec opsx <subcommand>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `track <workflow> [phase]` | Switch the active timer block for an OPSX workflow and expose imported Jira ticket context |
| `create-change [name]` | Create a change with session-aware governance and attach it back to the active session when possible |

**Examples:**

```bash
openspec opsx track explore --json
openspec opsx track propose discovery --json
openspec opsx create-change add-dark-mode
openspec opsx track propose generation
openspec opsx track propose review
```

**What it does:**

1. Reuses the imported Jira ticket from the active session as structured OPSX context
2. Switches timer blocks natively between `human_agent_interaction / spec` and `ai_autonomous / spec`
3. Refuses session-aware change creation when the active session is `sync_pending`
4. Attaches the created change back to the active session when the session is running or paused

### `openspec monitoring`

Export consolidated operations metrics and generate a static dashboard from the runtime and timer data already stored in the workspace.

```
openspec monitoring <subcommand>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `export` | Emit a consolidated JSON dataset for operations monitoring |
| `build-site` | Generate a static HTML dashboard with embedded monitoring data |
| `serve` | Serve the dashboard locally with `monitoring-data.json` regenerated on each request |

**Examples:**

```bash
openspec monitoring export
openspec monitoring export --output demo-output/monitoring-data.json
openspec monitoring build-site --output demo-output/operations-monitoring-site
openspec monitoring build-site --output demo-output/operations-monitoring-site --title "OpenSpec Operations Room"
openspec monitoring serve --port 8001
openspec monitoring serve --host 127.0.0.1 --port 8001 --title "OpenSpec Operations Room"
```

**What it includes:**

1. Session and block-level raw time by `actor_mode` and `work_kind`
2. Windowed metrics for `7d`, `30d`, and `all time`
3. Flow, reliability, approval, and archive-governance signals from runtime state
4. A static site bundle with `index.html`, `app.js`, `styles.css`, and `monitoring-data.json`

`monitoring serve` is the recommended local workflow when you want the dashboard to stay available and pick up active sessions on browser refresh without rebuilding the static bundle manually.

---

## Lifecycle Commands

### `openspec archive`

Archive a completed change and sync an active Jira worklog session. If a timer session is active and no `change-name` is provided, `archive` closes the timer and creates the Jira worklog.

When `change-name` is provided, OpenSpec first attempts to archive the change. If validation blocks the archive, the change remains open, but the active timer is still closed and synced as a Jira worklog because it represents developer time already spent. OpenSpec attempts to add a Jira issue comment with the blocking reason.

```
openspec archive [change-name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Change to archive (prompts if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompts |
| `--skip-specs` | Skip spec updates (for infrastructure/tooling/doc-only changes) |
| `--no-validate` | Skip validation (requires confirmation) |
| `--comment <text>` | Override the Jira worklog comment |
| `--retry` | Retry a previously failed Jira worklog sync |

**Examples:**

```bash
# Interactive archive
openspec archive

# Archive specific change
openspec archive add-dark-mode

# Archive without prompts (CI/scripts)
openspec archive add-dark-mode --yes

# Archive a tooling change that doesn't affect specs
openspec archive update-ci-config --skip-specs

# Close the active timer with a custom Jira worklog comment
openspec archive --comment "OpenSpec implementation session"

# Retry a failed Jira worklog sync
openspec archive --retry
```

**What it does:**

1. Validates and archives the change when a change is selected
2. Calculates active timer duration when `.openspec/session.json` exists
3. Rounds duration according to `worklog.rounding` and `worklog.min_seconds`
4. Creates a Jira worklog with `timeSpentSeconds`, `started`, and an ADF comment
5. Attempts to add a Jira issue comment with the archive result
6. Saves local sync metadata under `.openspec/sessions/`

Adding the Jira issue comment requires the Jira `Add comments` permission. If that permission is missing, the worklog can still be created and OpenSpec prints a warning.

---

## Creation Commands

### `openspec new change`

Create a new change directory. You can pass a name directly or create one from a Jira ticket.

```
openspec new change [name] [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--description <text>` | Description to add to `README.md` |
| `--schema <name>` | Workflow schema to use |
| `--from-ticket <issue-key>` | Import a Jira ticket and create `proposal.md`, `tasks.md`, `jira-ticket.md`, and an initial delta spec enriched from SDD sections when present |

**Examples:**

```bash
openspec new change add-dark-mode
openspec new change --from-ticket PROJ-123
openspec new change custom-name --from-ticket PROJ-123
```

On this fork, `osj new change --from-session` still exists as a low-level helper when you want to create artifacts directly from the active Jira session. For the native OPSX-backed flow behind `/opsx:propose`, prefer `osj opsx create-change <name>`.

---

## Workflow Commands

These commands support the artifact-driven OPSX workflow. They're useful for both humans checking progress and agents determining next steps. In the Jira/Tempo fork, they complement the `openspec opsx ...` session helpers described above.

### `openspec status`

Display artifact completion status for a change.

```
openspec status [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--change <id>` | Change name (prompts if omitted) |
| `--schema <name>` | Schema override (auto-detected from change's config) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Interactive status check
openspec status

# Status for specific change
openspec status --change add-dark-mode

# JSON for agent use
openspec status --change add-dark-mode --json
```

**Output (text):**

```
Change: add-dark-mode
Schema: spec-driven
Progress: 2/4 artifacts complete

[x] proposal
[ ] design
[x] specs
[-] tasks (blocked by: design)
```

**Output (JSON):**

```json
{
  "changeName": "add-dark-mode",
  "schemaName": "spec-driven",
  "isComplete": false,
  "applyRequires": ["tasks"],
  "artifacts": [
    {"id": "proposal", "outputPath": "proposal.md", "status": "done"},
    {"id": "design", "outputPath": "design.md", "status": "ready"},
    {"id": "specs", "outputPath": "specs/**/*.md", "status": "done"},
    {"id": "tasks", "outputPath": "tasks.md", "status": "blocked", "missingDeps": ["design"]}
  ]
}
```

---

### `openspec instructions`

Get enriched instructions for creating an artifact or applying tasks. Used by AI agents to understand what to create next.

```
openspec instructions [artifact] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `artifact` | No | Artifact ID: `proposal`, `specs`, `design`, `tasks`, or `apply` |

**Options:**

| Option | Description |
|--------|-------------|
| `--change <id>` | Change name (required in non-interactive mode) |
| `--schema <name>` | Schema override |
| `--json` | Output as JSON |

**Special case:** Use `apply` as the artifact to get task implementation instructions.

**Examples:**

```bash
# Get instructions for next artifact
openspec instructions --change add-dark-mode

# Get specific artifact instructions
openspec instructions design --change add-dark-mode

# Get apply/implementation instructions
openspec instructions apply --change add-dark-mode

# JSON for agent consumption
openspec instructions design --change add-dark-mode --json
```

**Output includes:**

- Template content for the artifact
- Project context from config
- Content from dependency artifacts
- Per-artifact rules from config

---

### `openspec templates`

Show resolved template paths for all artifacts in a schema.

```
openspec templates [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--schema <name>` | Schema to inspect (default: `spec-driven`) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Show template paths for default schema
openspec templates

# Show templates for custom schema
openspec templates --schema my-workflow

# JSON for programmatic use
openspec templates --json
```

**Output (text):**

```
Schema: spec-driven

Templates:
  proposal  → ~/.openspec/schemas/spec-driven/templates/proposal.md
  specs     → ~/.openspec/schemas/spec-driven/templates/specs.md
  design    → ~/.openspec/schemas/spec-driven/templates/design.md
  tasks     → ~/.openspec/schemas/spec-driven/templates/tasks.md
```

---

### `openspec schemas`

List available workflow schemas with their descriptions and artifact flows.

```
openspec schemas [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Example:**

```bash
openspec schemas
```

**Output:**

```
Available schemas:

  spec-driven (package)
    The default spec-driven development workflow
    Flow: proposal → specs → design → tasks

  my-custom (project)
    Custom workflow for this project
    Flow: research → proposal → tasks
```

---

## Schema Commands

Commands for creating and managing custom workflow schemas.

### `openspec schema init`

Create a new project-local schema.

```
openspec schema init <name> [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Schema name (kebab-case) |

**Options:**

| Option | Description |
|--------|-------------|
| `--description <text>` | Schema description |
| `--artifacts <list>` | Comma-separated artifact IDs (default: `proposal,specs,design,tasks`) |
| `--default` | Set as project default schema |
| `--no-default` | Don't prompt to set as default |
| `--force` | Overwrite existing schema |
| `--json` | Output as JSON |

**Examples:**

```bash
# Interactive schema creation
openspec schema init research-first

# Non-interactive with specific artifacts
openspec schema init rapid \
  --description "Rapid iteration workflow" \
  --artifacts "proposal,tasks" \
  --default
```

**What it creates:**

```
openspec/schemas/<name>/
├── schema.yaml           # Schema definition
└── templates/
    ├── proposal.md       # Template for each artifact
    ├── specs.md
    ├── design.md
    └── tasks.md
```

---

### `openspec schema fork`

Copy an existing schema to your project for customization.

```
openspec schema fork <source> [name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `source` | Yes | Schema to copy |
| `name` | No | New schema name (default: `<source>-custom`) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Overwrite existing destination |
| `--json` | Output as JSON |

**Example:**

```bash
# Fork the built-in spec-driven schema
openspec schema fork spec-driven my-workflow
```

---

### `openspec schema validate`

Validate a schema's structure and templates.

```
openspec schema validate [name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | No | Schema to validate (validates all if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--verbose` | Show detailed validation steps |
| `--json` | Output as JSON |

**Example:**

```bash
# Validate a specific schema
openspec schema validate my-workflow

# Validate all schemas
openspec schema validate
```

---

### `openspec schema which`

Show where a schema resolves from (useful for debugging precedence).

```
openspec schema which [name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | No | Schema name |

**Options:**

| Option | Description |
|--------|-------------|
| `--all` | List all schemas with their sources |
| `--json` | Output as JSON |

**Example:**

```bash
# Check where a schema comes from
openspec schema which spec-driven
```

**Output:**

```
spec-driven resolves from: package
  Source: /usr/local/lib/node_modules/@fission-ai/openspec/schemas/spec-driven
```

**Schema precedence:**

1. Project: `openspec/schemas/<name>/`
2. User: `~/.local/share/openspec/schemas/<name>/`
3. Package: Built-in schemas

---

## Configuration Commands

### `openspec config`

View and modify global OpenSpec configuration.

```
openspec config <subcommand> [options]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `path` | Show config file location |
| `list` | Show all current settings |
| `show` | Alias for `list` |
| `get <key>` | Get a specific value |
| `set <key> <value>` | Set a value |
| `unset <key>` | Remove a key |
| `reset` | Reset to defaults |
| `edit` | Open in `$EDITOR` |
| `profile [preset]` | Configure workflow profile interactively or via preset |

**Examples:**

```bash
# Show config file path
openspec config path

# List all settings
openspec config list

# Get a specific value
openspec config get telemetry.enabled

# Set a value
openspec config set telemetry.enabled false

# Set a string value explicitly
openspec config set user.name "My Name" --string

# Configure Jira worklog sync
openspec config set jira.base_url https://your-company.atlassian.net
openspec config set jira.email dev@example.com
openspec config set jira.api_token your-token
openspec config set worklog.rounding minute
openspec config set worklog.min_seconds 60

# Remove a custom setting
openspec config unset user.name

# Reset all configuration
openspec config reset --all --yes

# Edit config in your editor
openspec config edit

# Configure profile with action-based wizard
openspec config profile

# Fast preset: switch workflows to core (keeps delivery mode)
openspec config profile core
```

`openspec config profile` starts with a current-state summary, then lets you choose:
- Change delivery + workflows
- Change delivery only
- Change workflows only
- Keep current settings (exit)

If you keep current settings, no changes are written and no update prompt is shown.
If there are no config changes but the current project files are out of sync with your global profile/delivery, OpenSpec will show a warning and suggest running `openspec update`.
Pressing `Ctrl+C` also cancels the flow cleanly (no stack trace) and exits with code `130`.
In the workflow checklist, `[x]` means the workflow is selected in global config. To apply those selections to project files, run `openspec update` (or choose `Apply changes to this project now?` when prompted inside a project).

**Interactive examples:**

```bash
# Delivery-only update
openspec config profile
# choose: Change delivery only
# choose delivery: Skills only

# Workflows-only update
openspec config profile
# choose: Change workflows only
# toggle workflows in the checklist, then confirm
```

---

## Utility Commands

### `openspec feedback`

Submit feedback about OpenSpec. Creates a GitHub issue.

```
openspec feedback <message> [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `message` | Yes | Feedback message |

**Options:**

| Option | Description |
|--------|-------------|
| `--body <text>` | Detailed description |

**Requirements:** GitHub CLI (`gh`) must be installed and authenticated.

**Example:**

```bash
openspec feedback "Add support for custom artifact types" \
  --body "I'd like to define my own artifact types beyond the built-in ones."
```

---

### `openspec completion`

Manage shell completions for the OpenSpec CLI.

```
openspec completion <subcommand> [shell]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `generate [shell]` | Output completion script to stdout |
| `install [shell]` | Install completion for your shell |
| `uninstall [shell]` | Remove installed completions |

**Supported shells:** `bash`, `zsh`, `fish`, `powershell`

**Examples:**

```bash
# Install completions (auto-detects shell)
openspec completion install

# Install for specific shell
openspec completion install zsh

# Generate script for manual installation
openspec completion generate bash > ~/.bash_completion.d/openspec

# Uninstall
openspec completion uninstall
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (validation failure, missing files, etc.) |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENSPEC_TELEMETRY` | Set to `0` to disable telemetry |
| `DO_NOT_TRACK` | Set to `1` to disable telemetry (standard DNT signal) |
| `OPENSPEC_CONCURRENCY` | Default concurrency for bulk validation (default: 6) |
| `EDITOR` or `VISUAL` | Editor for `openspec config edit` |
| `NO_COLOR` | Disable color output when set |

---

## Related Documentation

- [Commands](commands.md) - AI slash commands (`/opsx:propose`, `/opsx:apply`, etc.)
- [Workflows](workflows.md) - Common patterns and when to use each command
- [Customization](customization.md) - Create custom schemas and templates
- [Getting Started](getting-started.md) - First-time setup guide
