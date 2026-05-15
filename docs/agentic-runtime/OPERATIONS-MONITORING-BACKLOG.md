# Operations Monitoring Backlog

See also: [ARCHITECTURE](./ARCHITECTURE.md), [CURRENT-IMPLEMENTATION](./CURRENT-IMPLEMENTATION.md), [IMPLEMENTATION-BACKLOG](./IMPLEMENTATION-BACKLOG.md), [AUTONOMY-POLICY](./AUTONOMY-POLICY.md), [STATE-MACHINES](./STATE-MACHINES.md)

## Purpose

This backlog defines the monitoring roadmap for the `osj` and `opsx` operating model.

The goal is not just to record worklogs. The goal is to make production operations visible across:

- capacity and focus
- human vs human+AI vs autonomous AI effort
- flow efficiency and WIP pressure
- reliability of archive/worklog sync
- approval and governance friction
- rework, quality, and operational health

## Prioritization Rule

Visualization comes first.

Before building a heavy telemetry pipeline, central warehouse, or complex alerting, we should first ship high-signal visualizations on top of the runtime and timer data we already have. That gives the team operational visibility quickly and lets us validate which metrics are actually useful before investing in deeper infrastructure.

Priority order:

1. visualization of already-available metrics
2. lightweight derived datasets and exports to support those visuals
3. thresholds, alerts, and weekly operational reporting
4. external integrations for full lead-time and business-level analytics

## Data Already Available Now

The current repository already captures enough signal for a strong first monitoring layer.

### Current sources

| Source | What it gives us |
| --- | --- |
| `.openspec/session.json` | active session state |
| `.openspec/sessions/*.json` | closed session history |
| `.openspec/runtime/tickets/*/session.json` | runtime session state, autonomy level, active mode/kind, cycle counter |
| `.openspec/runtime/tickets/*/ticket-runtime.json` | ticket runtime state |
| `.openspec/runtime/tickets/*/changes/*/change-runtime.json` | change runtime state, archive/worklog eligibility |
| `.openspec/runtime/tickets/*/changes/*/cycles/*.json` | cycle states and retries |
| `.openspec/runtime/tickets/*/approvals/*.json` | approval creation and resolution |
| `.openspec/runtime/tickets/*/changes/*/validation/*.json` | validation outcomes and failure classification |
| `.openspec/runtime/tickets/*/changes/*/delivery/*.json` | archive decision and worklog allowance |
| timer blocks in session files | `actor_mode`, `work_kind`, start/end, raw seconds, description |
| Jira worklog sync results in session files | rounded duration, sync state, worklog ids, sync errors |

### Metrics we can derive immediately

| Category | Ready now? | Notes |
| --- | --- | --- |
| raw hours by ticket/change/developer | yes | use block raw duration |
| rounded Jira-billed hours | yes | use rounded worklog durations |
| human vs human+AI vs AI time split | yes | from `actor_mode` |
| implementation/spec/review/bugfix/rework/testing split | yes | from `work_kind` |
| pause ratio | yes | from pause events and session duration |
| throughput | yes | archived changes per period |
| cycle count per change | yes | from execution cycles |
| retry and escalation rates | yes | from cycle and validation states |
| archive blocked rate | yes | from change state and delivery artifacts |
| sync failure and retry rates | yes | from `worklog_status` and `sync_error` |
| WIP by runtime state | yes | from ticket/session/change runtime states |
| first-pass success rate | yes | from cycle history |
| lead time idea to prod | partial | needs Jira created dates plus deploy events |
| code review wait time | partial | needs PR/review timestamps |
| deployment frequency | no | needs CI/deploy integration |
| gross capacity vs net capacity | partial | needs working calendar, ceremonies, PTO, support rotations |

## Semantic Layer

To keep dashboards consistent, use these operating definitions.

| Metric | Definition |
| --- | --- |
| `raw_logged_hours` | sum of `raw_duration_seconds` converted to hours |
| `jira_billed_hours` | sum of `rounded_duration_seconds` converted to hours |
| `human_hours` | blocks where `actor_mode = human` |
| `joint_hours` | blocks where `actor_mode = human_agent_interaction` |
| `ai_hours` | blocks where `actor_mode = ai_autonomous` |
| `planning_hours` | blocks where `work_kind = spec` |
| `delivery_hours` | blocks where `work_kind in (implementation, review, testing)` |
| `maintenance_hours` | blocks where `work_kind in (bugfix, rework)` |
| `pause_ratio` | paused seconds / total raw session seconds |
| `sync_failure_rate` | sessions entering `sync_pending` / sessions closed |
| `archive_block_rate` | archive-blocked changes / archive-attempted changes |
| `first_pass_success_rate` | changes validated and archived without retry cycle |
| `ai_leverage_ratio` | `ai_hours / (human_hours + joint_hours)` |
| `collaboration_ratio` | `joint_hours / raw_logged_hours` |

Important rule:

- operational analytics should use raw block durations by default
- financial, billing, or Jira-reconciliation views should use rounded Jira worklog durations

## P0 Backlog: Visualization-First Quick Wins

These items should be delivered before building a heavy telemetry platform.

### OM-001: Derived Operations Metrics Export

Priority: `P0`

Objective:
Create one lightweight derived dataset that flattens sessions, blocks, runtime state, approvals, validations, and worklog sync results for dashboarding.

Deliverable:
- a repeatable export command or script that emits JSON or CSV from existing runtime files
- one documented schema for dashboard consumption

Must include:
- ticket key
- change name
- session id
- developer id
- autonomy level
- actor mode
- work kind
- raw and rounded duration
- session state
- ticket state
- change state
- current cycle
- worklog status
- sync error

Acceptance criteria:
- a dashboard can be built without scraping multiple runtime folders manually
- the export distinguishes raw time from rounded Jira-billed time

### OM-002: Operations Overview Dashboard

Priority: `P0`

Objective:
Give engineering leadership and delivery ops one page that answers "what is happening right now?"

Visuals:
- active sessions by state: `ACTIVE`, `PAUSED`, `SYNC_PENDING`, `AWAITING_HUMAN`
- active tickets by runtime state
- active changes by runtime state
- count of pending approvals
- sessions with sync failure
- archive-blocked changes

Acceptance criteria:
- one operator can detect operational distress in under 60 seconds
- `sync_pending` and pending approvals are immediately visible

### OM-003: Capacity And Focus Dashboard

Priority: `P0`

Objective:
Measure real productive bandwidth instead of theoretical hours.

Visuals:
- raw logged hours vs Jira-billed hours
- human vs joint vs AI hours stacked by week
- pause ratio by developer and team
- planning vs delivery vs maintenance hours
- maintenance reserve actual percentage
- focus trend by week

Suggested cuts:
- by developer
- by ticket type
- by change
- by week

Acceptance criteria:
- the team can estimate observed net productive bandwidth from real operating data
- focus loss and maintenance starvation are visible without manual spreadsheet work

### OM-004: Flow Efficiency Dashboard

Priority: `P0`

Objective:
Make WIP pressure, cycle time, and throughput operationally visible.

Visuals:
- throughput: archived changes per week
- changes by number of cycles
- first-pass success vs retry-required
- current WIP by ticket/change state
- changes stuck in `UNDER_REVIEW`, `VALIDATION_FAILED`, or `HUMAN_ESCALATION_REQUIRED`
- age of active sessions and age of active changes

Acceptance criteria:
- bottlenecks in planning, implementation, validation, or approval are obvious
- the team can see where work accumulates before it turns into delivery delay

### OM-005: Reliability And Governance Dashboard

Priority: `P0`

Objective:
Monitor whether the operating system itself is healthy.

Visuals:
- sync failure rate
- retry success rate
- `sync_pending` recovery time
- archive blocked rate
- approval creation rate
- approval resolution time
- validations by classification
- top blocker reasons from runtime explain / delivery artifacts

Acceptance criteria:
- operational failures are separated from product delivery failures
- the team can see whether governance is helping or becoming friction

### OM-006: Human And AI Collaboration Dashboard

Priority: `P0`

Objective:
Understand how the team is actually using AI in production work.

Visuals:
- human vs joint vs AI time split
- AI time by work kind
- joint collaboration time by work kind
- AI leverage ratio by developer, ticket type, and change
- planning-time AI share vs delivery-time AI share
- changes closed with high AI contribution vs low AI contribution

Acceptance criteria:
- the team can identify whether AI is mostly helping in discovery, planning, implementation, or rework
- the dashboard avoids vanity metrics and keeps work outcome linked to the time split

## P1 Backlog: Monitoring Hardening

### OM-101: Historical Snapshot Pipeline

Priority: `P1`

Objective:
Persist daily or hourly snapshots so dashboards are not limited to the current filesystem state.

Deliverable:
- append-only metrics history
- snapshot retention policy

### OM-102: WIP Thresholds And Alerting

Priority: `P1`

Objective:
Add simple alerts for operational stress.

Suggested alerts:
- too many active sessions per developer
- `sync_pending` older than threshold
- approval pending older than threshold
- archive blocked changes older than threshold
- changes with too many cycles

### OM-103: Rework And Quality Dashboard

Priority: `P1`

Objective:
Make invisible quality drag visible.

Visuals:
- bugfix plus rework share by team and period
- failed validation rate
- failed escalated rate
- cycle count distribution
- time from first implementation block to archive

### OM-104: Team Investment Profile Dashboard

Priority: `P1`

Objective:
Track whether the portfolio mix matches the intended operating model.

Visuals:
- new feature vs maintenance vs support proxy mix
- planning vs implementation vs review vs maintenance trend
- emergency/unplanned work proxy from bugfix/rework spikes

Note:
This becomes stronger once we add richer `work_kind` values such as `support`, `incident`, and `tech_debt`.

## P2 Backlog: External Integration And Advanced Analytics

### OM-201: Jira Lead Time Dashboard

Priority: `P2`

Objective:
Add full lead-time visibility from issue creation to archive and production.

Needs:
- Jira created timestamps
- status transition timestamps

### OM-202: PR And Code Review Flow Dashboard

Priority: `P2`

Objective:
Measure review wait time and merge friction.

Needs:
- GitHub PR opened, review requested, approved, merged timestamps

### OM-203: Deployment Frequency And Change Failure Dashboard

Priority: `P2`

Objective:
Connect operational flow to delivery outcomes in production.

Needs:
- deploy events
- incident or rollback markers

### OM-204: Capacity Planning Dashboard

Priority: `P2`

Objective:
Move from observed effort to planning-grade net capacity.

Needs:
- team calendar
- PTO
- ceremonies
- support rotation
- working-day assumptions

### OM-205: Forecasting And SLA Dashboard

Priority: `P2`

Objective:
Forecast delivery and detect aging risk early.

Visuals:
- percentile cycle-time bands
- forecasted throughput
- age of WIP by percentile
- approval and sync recovery SLA compliance

## Recommended Delivery Order

1. `OM-001` Derived Operations Metrics Export
2. `OM-002` Operations Overview Dashboard
3. `OM-003` Capacity And Focus Dashboard
4. `OM-005` Reliability And Governance Dashboard
5. `OM-004` Flow Efficiency Dashboard
6. `OM-006` Human And AI Collaboration Dashboard
7. `OM-101` Historical Snapshot Pipeline
8. `OM-103` Rework And Quality Dashboard
9. `OM-102` WIP Thresholds And Alerting
10. `OM-104` Team Investment Profile Dashboard
11. `OM-201` onward as external integrations mature

## Suggested Visualization Stack

Keep this lightweight first.

Recommended initial approach:

- export metrics locally as JSON or CSV
- build first dashboards in Metabase, Grafana, or a simple static notebook/dashboard
- validate metric usefulness with weekly ops reviews
- only then invest in a warehouse or always-on telemetry service

## Open Gaps

These are the biggest instrumentation gaps for later phases:

- no first-class `meeting`, `support`, `incident`, or `tech_debt` work kinds yet
- no formal event stream or centralized history store yet
- no built-in PR, review, or deploy timestamps yet
- no team calendar or PTO model yet
- no production incident linkage yet

## Definition Of Done For The Monitoring Slice

The monitoring slice is meaningfully delivered when:

- the team has at least three production-grade dashboards in regular use
- those dashboards are built from one documented derived dataset
- operators can detect `sync_pending`, approval bottlenecks, archive friction, and WIP overload quickly
- leadership can see capacity split across human, joint, and AI work without manual reporting
