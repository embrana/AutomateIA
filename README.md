<p align="center">
  <a href="https://github.com/embrana/AutomateIA">
    <picture>
      <source srcset="assets/openspec_bg.png">
      <img src="assets/openspec_bg.png" alt="OpenSpec logo">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/embrana/AutomateIA/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/embrana/AutomateIA/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/@fission-ai/openspec"><img alt="npm version" src="https://img.shields.io/npm/v/@fission-ai/openspec?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://discord.gg/YctCnvvshC"><img alt="Discord" src="https://img.shields.io/discord/1411657095639601154?style=flat-square&logo=discord&logoColor=white&label=Discord&suffix=%20online" /></a>
</p>

<details>
<summary><strong>The most loved spec framework.</strong></summary>

[![Stars](https://img.shields.io/github/stars/embrana/AutomateIA?style=flat-square&label=Stars)](https://github.com/embrana/AutomateIA/stargazers)
[![Downloads](https://img.shields.io/npm/dm/@fission-ai/openspec?style=flat-square&label=Downloads/mo)](https://www.npmjs.com/package/@fission-ai/openspec)
[![Contributors](https://img.shields.io/github/contributors/embrana/AutomateIA?style=flat-square&label=Contributors)](https://github.com/embrana/AutomateIA/graphs/contributors)

</details>
<p></p>
Our philosophy:

```text
→ fluid not rigid
→ iterative not waterfall
→ easy not complex
→ built for brownfield not just greenfield
→ scalable from personal projects to enterprises
```

> [!TIP]
> **New workflow now available!** We've rebuilt OpenSpec with a new artifact-guided workflow.
>
> Run `/opsx:propose "your idea"` to get started. → [Learn more here](docs/opsx.md)

<p align="center">
  Follow <a href="https://x.com/0xTab">@0xTab on X</a> for updates · Join the <a href="https://discord.gg/YctCnvvshC">OpenSpec Discord</a> for help and questions.
</p>

<!-- TODO: Add GIF demo of /opsx:propose → /opsx:archive workflow -->

## See it in action

```text
You: /opsx:propose add-dark-mode
AI:  Created openspec/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for implementation!

You: /opsx:apply
AI:  Implementing tasks...
     ✓ 1.1 Add theme context provider
     ✓ 1.2 Create toggle component
     ✓ 2.1 Add CSS variables
     ✓ 2.2 Wire up localStorage
     All tasks complete!

You: /opsx:archive
AI:  Archived to openspec/changes/archive/2025-01-23-add-dark-mode/
     Specs updated. Ready for the next feature.
```

<details>
<summary><strong>OpenSpec Dashboard</strong></summary>

<p align="center">
  <img src="assets/openspec_dashboard.png" alt="OpenSpec dashboard preview" width="90%">
</p>

</details>

## Quick Start

**Requires Node.js 20.19.0 or higher.**

Install OpenSpec globally:

```bash
npm install -g @fission-ai/openspec@latest
```

Then navigate to your project directory and initialize:

```bash
cd your-project
openspec init
```

Now tell your AI: `/opsx:propose <what-you-want-to-build>`

If you want the expanded workflow (`/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:sync`, `/opsx:bulk-archive`, `/opsx:onboard`), select it with `openspec config profile` and apply with `openspec update`.

> [!NOTE]
> Not sure if your tool is supported? [View the full list](docs/supported-tools.md) – we support 25+ tools and growing.
>
> Also works with pnpm, yarn, bun, and nix. [See installation options](docs/installation.md).

## Jira / Tempo Worklog Tracking

This fork installs a separate CLI named `openspec-jira` so it can live alongside the official `openspec` package without one overwriting the other. If your team installs this fork from Git, use `openspec-jira` for the Jira/Tempo workflow commands.

OpenSpec can track a local work session and create a Jira Cloud worklog when you archive it. For the MVP, OpenSpec writes to Jira's native worklog API; Tempo Timesheets reflects those Jira worklogs inside the Jira/Tempo ecosystem. You do not need a Tempo API token unless you later want Tempo-specific API features like bulk reporting, teams, accounts, approvals, or worklog attributes.

When a timed archive succeeds, OpenSpec also tries to add a Jira issue comment summarizing the archive and worklog. If the OpenSpec archive is blocked by validation, the change remains open, but the active timer is still closed and synced as a Jira worklog because it represents developer time already spent. OpenSpec also tries to add a Jira issue comment with the blocking reason. This comment requires the Jira `Add comments` permission; if that permission is missing, worklog creation still succeeds but the Jira note is skipped with a warning.

### Install This Fork

Install the fork once:

```bash
npm install -g git+ssh://git@github.com/embrana/AutomateIA.git
```

If you are working from a local clone of this repository:

```bash
npm install
npm run build
npm install -g .
```

Check that the forked CLI is available:

```bash
openspec-jira --help
```

For the daily Jira/Tempo workflow commands:

```bash
openspec-jira hlp
openspec-jira hlp --short
openspec-jira hlp --demo
```

### Configure Jira Once

Configure Jira once per developer machine:

```bash
openspec-jira config set jira.base_url https://your-company.atlassian.net
openspec-jira config set jira.email dev@example.com
openspec-jira config set jira.api_token YOUR_ATLASSIAN_API_TOKEN
openspec-jira config set worklog.rounding minute
openspec-jira config set worklog.min_seconds 60
```

Check the config without printing the token:

```bash
openspec-jira config show
```

List your assigned Jira tickets:

```bash
openspec-jira tickets
```

If `jira.default_project` is configured, `tickets` filters by that project. Use `--all-projects` to ignore the default project, or `--project PROJ` to choose one explicitly.

Use the visible Jira issue key from the ticket, such as `PROJ-123`. You can find it in the ticket header or URL:

```text
https://your-company.atlassian.net/browse/PROJ-123
```

Required Jira permissions:

```text
Browse Projects
Work on Issues
Add comments
```

`Add comments` is only needed to write the OpenSpec archive summary back to the Jira ticket. If it is missing, the worklog can still be created.

### Choose The Right Command

Use this command when the change already exists and you only want to start a new timer session while importing Jira context:

```bash
openspec-jira purpose --jira PROJ-123 --import-ticket
```

This means:

```text
timer + Jira ticket context in .openspec/session.json
no new OpenSpec artifacts
no overwrite of existing change files
```

Use this command when you want to pick one of your assigned Jira tickets instead of typing the issue key:

```bash
openspec-jira purpose --pick --import-ticket
```

This means:

```text
lists assigned Jira tickets
lets you choose one
starts the timer for the selected ticket
imports Jira ticket context if --import-ticket is present
```

Use this command when you want to start the timer and create OpenSpec artifacts from the Jira ticket:

```bash
openspec-jira purpose --jira PROJ-123 --import-ticket --create-change
```

This means:

```text
timer + Jira ticket context
attempts to create a new OpenSpec change
creates proposal.md, tasks.md, jira-ticket.md, and specs/<change-name>/spec.md
fails instead of overwriting if the change already exists
```

Use this command when you want to create OpenSpec artifacts from Jira without starting a timer:

```bash
openspec-jira new change --from-ticket PROJ-123
```

This means:

```text
no timer
attempts to create a new OpenSpec change
creates proposal.md, tasks.md, jira-ticket.md, and specs/<change-name>/spec.md
fails instead of overwriting if the change already exists
```

With `--import-ticket`, OpenSpec stores ticket context in the active session: `key`, `summary`, `status`, `assignee`, `description_text`, and `url`. The `description_text` value is the plain-text form of the Jira ticket description.

### Happy Path

Create a timer session and artifacts from a Jira ticket:

```bash
openspec-jira purpose --jira PROJ-123 --import-ticket --create-change
```

Check what was created:

```bash
openspec-jira timer status
openspec-jira list
openspec-jira status --change <change-name>
openspec-jira show <change-name> --type change
```

Ask your coding agent to implement the change using:

```text
openspec/changes/<change-name>/proposal.md
openspec/changes/<change-name>/tasks.md
openspec/changes/<change-name>/jira-ticket.md
openspec/changes/<change-name>/specs/<change-name>/spec.md
```

Validate before archiving:

```bash
openspec-jira validate <change-name> --type change
```

Preview the Jira worklogs before writing anything:

```bash
openspec-jira timer report
openspec-jira archive <change-name> --dry-run
```

`timer report` shows the active timer breakdown. `archive --dry-run` shows the same Jira worklog preview and does not archive OpenSpec files or write worklogs/comments to Jira.

Archive and create the Jira worklog:

```bash
openspec-jira archive <change-name> --yes --comment "OpenSpec implementation session"
```

Use the change name printed by `purpose --create-change` in the archive command.

### Retake Work After An Abort

If archive validation fails, the change remains open under `openspec/changes/<change-name>/`. The elapsed developer time is still sent to Jira as a worklog, and OpenSpec tries to add a compact Jira comment explaining why the archive was blocked.

To continue working on the same ticket later, start a new timer session without recreating artifacts:

```bash
openspec-jira purpose --jira PROJ-123 --import-ticket
```

Then work on the existing change and archive again:

```bash
openspec-jira validate <change-name> --type change
openspec-jira archive <change-name> --yes --comment "Correction and archive"
```

OpenSpec stores the active timer in `.openspec/session.json` and completed local metadata in `.openspec/sessions/`. Jira credentials are stored in the user's global OpenSpec config, normally `~/.config/openspec/config.json`; avoid committing API tokens to a project repository.

When the Jira description contains structured SDD sections such as `## Acceptance Criteria`, `## Business Rules`, `## Domain / Data / Integration Contracts`, `## UX / Error States`, or `## Out of Scope`, OpenSpec uses those sections to create a richer delta spec. Acceptance criteria headings like `### CA-1 — ...` become OpenSpec scenarios.

See the full terminal reference in [CLI](docs/cli.md).

For a complete demo script, see [Jira / Tempo Happy Path Demo](docs/demo-jira-tempo-happy-path.md).

To run a local sandbox version without real Jira credentials:

```bash
npm run demo:jira
```

The generated demo workspace is written to `demo-output/jira-happy-path/` so you can inspect the created OpenSpec change, archived specs, session metadata, and mock Jira worklog payload.

The values `https://your-company.atlassian.net`, `dev@example.com`, `YOUR_ATLASSIAN_API_TOKEN`, and `PROJ-123` are examples for the real Jira flow. Replace them with real Jira values, or use `npm run demo:jira` for the sandbox path.

## Docs

→ **[Getting Started](docs/getting-started.md)**: first steps<br>
→ **[Workflows](docs/workflows.md)**: combos and patterns<br>
→ **[Commands](docs/commands.md)**: slash commands & skills<br>
→ **[CLI](docs/cli.md)**: terminal reference<br>
→ **[Jira / Tempo Happy Path Demo](docs/demo-jira-tempo-happy-path.md)**: end-to-end demo flow<br>
→ **[Supported Tools](docs/supported-tools.md)**: tool integrations & install paths<br>
→ **[Concepts](docs/concepts.md)**: how it all fits<br>
→ **[Multi-Language](docs/multi-language.md)**: multi-language support<br>
→ **[Customization](docs/customization.md)**: make it yours


## Why OpenSpec?

AI coding assistants are powerful but unpredictable when requirements live only in chat history. OpenSpec adds a lightweight spec layer so you agree on what to build before any code is written.

- **Agree before you build** — human and AI align on specs before code gets written
- **Stay organized** — each change gets its own folder with proposal, specs, design, and tasks
- **Work fluidly** — update any artifact anytime, no rigid phase gates
- **Use your tools** — works with 20+ AI assistants via slash commands

### How we compare

**vs. [Spec Kit](https://github.com/github/spec-kit)** (GitHub) — Thorough but heavyweight. Rigid phase gates, lots of Markdown, Python setup. OpenSpec is lighter and lets you iterate freely.

**vs. [Kiro](https://kiro.dev)** (AWS) — Powerful but you're locked into their IDE and limited to Claude models. OpenSpec works with the tools you already use.

**vs. nothing** — AI coding without specs means vague prompts and unpredictable results. OpenSpec brings predictability without the ceremony.

## Updating OpenSpec

**Upgrade the package**

```bash
npm install -g @fission-ai/openspec@latest
```

**Refresh agent instructions**

Run this inside each project to regenerate AI guidance and ensure the latest slash commands are active:

```bash
openspec update
```

## Usage Notes

**Model selection**: OpenSpec works best with high-reasoning models. We recommend Opus 4.5 and GPT 5.2 for both planning and implementation.

**Context hygiene**: OpenSpec benefits from a clean context window. Clear your context before starting implementation and maintain good context hygiene throughout your session.

## Contributing

**Small fixes** — Bug fixes, typo corrections, and minor improvements can be submitted directly as PRs.

**Larger changes** — For new features, significant refactors, or architectural changes, please submit an OpenSpec change proposal first so we can align on intent and goals before implementation begins.

When writing proposals, keep the OpenSpec philosophy in mind: we serve a wide variety of users across different coding agents, models, and use cases. Changes should work well for everyone.

**AI-generated code is welcome** — as long as it's been tested and verified. PRs containing AI-generated code should mention the coding agent and model used (e.g., "Generated with Claude Code using claude-opus-4-5-20251101").

### Development

- Install dependencies: `pnpm install`
- Build: `pnpm run build`
- Test: `pnpm test`
- Develop CLI locally: `pnpm run dev` or `pnpm run dev:cli`
- Conventional commits (one-line): `type(scope): subject`

## Other

<details>
<summary><strong>Telemetry</strong></summary>

OpenSpec collects anonymous usage stats.

We collect only command names and version to understand usage patterns. No arguments, paths, content, or PII. Automatically disabled in CI.

**Opt-out:** `export OPENSPEC_TELEMETRY=0` or `export DO_NOT_TRACK=1`

</details>

<details>
<summary><strong>Maintainers & Advisors</strong></summary>

See [MAINTAINERS.md](MAINTAINERS.md) for the list of core maintainers and advisors who help guide the project.

</details>



## License

MIT
