# Implementation Backlog

See also: [ARCHITECTURE](./ARCHITECTURE.md), [STATE-MACHINES](./STATE-MACHINES.md), [AGENT-CONTRACTS](./AGENT-CONTRACTS.md), [AGENT-BACKENDS](./AGENT-BACKENDS.md), [AUTONOMY-POLICY](./AUTONOMY-POLICY.md), [CURRENT-IMPLEMENTATION](./CURRENT-IMPLEMENTATION.md)

## Goal

This backlog turns the architecture into a phased implementation plan for Codex. Each phase should end with observable runtime behavior, persisted artifacts, and tests.

## Cross-Phase Rules

1. Do not break existing `osj purpose`, `osj timer`, `osj archive`, or `osj validate` flows.
2. Prefer adapters and projections over big-bang rewrites.
3. Persist every new runtime decision under `.openspec/runtime/`.
4. Ship CLI observability before full automation.
5. Keep each phase independently testable and reversible.

## UX Follow-Ups

- `osj orchestrate --until <stage>` should print an explicit no-op summary when the runtime is already beyond the requested stage.
- The no-op output should include:
  - current ticket/session/change state
  - why no agent was executed
  - the next actionable command, for example `osj orchestrate --until implementation` or `osj approval show`
- `osj orchestrate --until <stage>` should also print an explicit terminal summary when a rerun ends in escalation, approval gating, or any other non-success stop condition.
- That terminal summary should include:
  - the last agent that ran
  - whether the cycle ended in `FAILED_ESCALATED`, `FAILED_RETRYABLE`, or another gated state
  - the primary reason, for example diff budget exceeded, critic findings remain, or `tasks.md` is incomplete
  - the approval id when one was created
  - the next actionable command, for example `osj approval show`, `osj approval accept <id>`, or `osj orchestrate --until delivery`
- `osj orchestrate --until <stage>` should print in-progress feedback while long-running agents are executing, especially `implementation_agent`.
- The in-progress feedback should include:
  - the active agent name
  - whether the runtime is waiting on a backend, applying workspace edits, or running validation commands
  - elapsed time since the agent started
  - a short heartbeat message so the terminal never looks frozen during a long run
- When available, the in-progress status should also surface bounded execution details such as:
  - backend name and mode
  - current phase, for example `reasoning`, `editing files`, or `running tests`
  - the current cycle id
- `osj runtime status` and `osj runtime explain` should stay aligned with that guidance so developers are never left with an empty terminal and no explanation.
- `osj runtime explain` should distinguish policy-budget escalations from generic cycle failures.
- When an implementation or critic cycle is cut off by diff/file-count policy, the explanation should include:
  - the measured value, for example `estimated diff size 1032`
  - the configured limit, for example `limit 800`
  - the agent that raised the escalation
  - the evidence artifact that contains the detailed assessment, for example `implementation/change-report.json` or `review/critic-report.json`
  - the recommended next action, for example `osj approval show`, `osj approval accept <id>`, or a narrower rerun after reducing scope
- The same policy-budget explanation should appear consistently in:
  - `osj runtime explain`
  - approval reasons
  - critic and validation summaries
  - future terminal summaries emitted by `osj orchestrate`
- The generated `/opsx-explore` and `/opsx-propose` prompts should continue calling the native `osj opsx ...` helpers so session-aware tracking and Jira-ticket reuse stay centralized in the CLI/runtime layer.
- The `osj opsx ...` helpers should keep producing enough structured output for prompt-based tools to explain:
  - current session state
  - imported Jira ticket context
  - whether tracking was actually applied
  - whether session-aware change creation is allowed
- The autonomous diff/file-count budget should be configurable per environment or per run so larger but still valid features do not always require manual overrides.
- At minimum, the runtime should support one of these paths:
  - global config for `max_diff_lines_without_human_review` and related thresholds
  - per-profile policy levels such as `strict`, `standard`, and `large_feature`
  - explicit CLI override for a single run, with the chosen budget persisted in runtime artifacts for traceability
- `osj runtime explain` and approval artifacts should surface the active policy profile or configured budget so developers understand why a feature was gated.
- Codex should continue exposing more `osj` flows directly in the IDE, but they should keep landing as thin wrappers over the CLI:
  - `/osj-timer-switch`
  - `/osj-orchestrate-*`
  - `/osj-approval-accept`
  - `/osj-approval-reject`
  - `/osj-archive`
- Several companion prompts already exist, including `/osj-purpose-start`, `/osj-ticket-show`, `/osj-runtime-status`, `/osj-runtime-explain`, `/osj-timer-report`, `/osj-timer-cancel`, and `/osj-archive-retry`.
- Those `/osj-*` wrappers should keep `osj` as the real backend so timer, worklog, approval, archive, and OPSX session-governance logic stays centralized in the CLI instead of being reimplemented in prompt text.

## Status Snapshot

Current repository status after the first seven runtime PRs:

- Phase 1 is implemented.
- Phase 2 is implemented.
- Phase 3 is implemented as a bounded `ImplementationAgent` adapter with pluggable backend routing and runtime-controlled local workspace execution.
- Phase 4 is partially implemented through current `CriticAgent`, `ValidationAgent`, cycle persistence, and failure classification.
- Phase 5 is partially implemented through `DeliveryAgent`, approvals, and archive governance.
- OPSX session-aware CLI helpers are implemented as a governance bridge between chat workflows and runtime state.
- Phase 6 remains future work.

## Phase 1. Runtime Formalization

Status: shipped

### Outcome

Make the runtime visible without introducing autonomous code edits yet.

### Scope

- add runtime entities: ticket, session, change, cycle, agent run
- implement state machine enums and transition validation
- persist runtime state under `.openspec/runtime/`
- create local event bus and event store
- expose runtime inspection in the CLI

### Suggested landing areas

- `src/core/runtime/session/SessionManager.ts`
- `src/core/runtime/state/StateEngine.ts`
- `src/core/runtime/state/*.ts` for machine definitions
- `src/core/runtime/events/EventBus.ts`
- `src/core/runtime/events/EventStore.ts`
- `src/storage/fs/RuntimeStore.ts`
- `src/cli/index.ts` for `osj runtime status`

### Stories

- Create `TicketRuntime`, `SessionRuntime`, `ChangeRuntime`, `ExecutionCycle`, and `AgentRun` schemas
- Implement deterministic transition guards
- Project the current `TimerSession` into `SessionRuntime`
- Add `osj runtime status`
- Add `osj runtime explain` for blocked/escalated sessions

### Done when

- starting a session creates runtime state and event artifacts
- `osj runtime status` can explain ticket, session, and change state
- existing timer flows still work

## Phase 2. Non-Destructive Agents

Status: shipped

### Outcome

Introduce context, spec, and planning agents that produce durable artifacts without touching product code.

### Scope

- implement `ContextAgent`
- implement `SpecAgent`
- implement `PlanningAgent`
- generate normalized context and execution plan artifacts
- add direct CLI entry points for those agents

### Suggested landing areas

- `src/agents/base/`
- `src/agents/context/ContextAgent.ts`
- `src/agents/spec/SpecAgent.ts`
- `src/agents/planning/PlanningAgent.ts`
- `src/core/runtime/context/ContextResolver.ts`
- `src/core/runtime/artifacts/ArtifactManager.ts`
- `src/cli/index.ts` for `osj agent run context|spec|planning`

### Stories

- Build the shared agent envelope
- Persist `normalized-context.json` and `context-summary.md`
- Generate or update OpenSpec artifacts from normalized context
- Persist `execution-plan.json` and `execution-plan.md`
- Add `osj orchestrate --until planning`

### Done when

- a session can produce context, change artifacts, and plan artifacts without human file wrangling
- plans and ambiguities are inspectable from the filesystem and CLI

## Phase 3. Implementation Agent Adapter

Status: shipped

### Outcome

Introduce controlled code editing under policy constraints.

### Scope

- implement `ImplementationAgent` adapter
- integrate with Codex as the code-editing backend
- enforce capability constraints and file/diff budgets
- persist implementation reports and changed-file summaries

### Suggested landing areas

- `src/agents/implementation/ImplementationAgent.ts`
- `src/core/runtime/orchestration/AgentOrchestrator.ts`
- `src/core/runtime/orchestration/AutonomyPolicy.ts`
- `src/core/runtime/orchestration/RuntimeCoordinator.ts`
- `src/core/runtime/orchestration/RetryPolicy.ts`

### Stories

- Build implementation run adapter with explicit constraints
- Store `change-report.json`
- Surface changed files, completed tasks, and remaining tasks
- Add `osj agent run implementation`
- Add `osj orchestrate --until implementation`

### Done when

- the runtime can execute one bounded implementation run and persist its report
- policy can reject runs that exceed allowed scope

### Current landing

- `ImplementationAgent` currently inspects the active workspace diff and writes `implementation/change-report.json`
- provider-agnostic backend routing is implemented through:
  - `manual`
  - `openai_compatible`
  - `command`
  - `anthropic_native`
  - `gemini_native`
- backend prompt/request/response artifacts are persisted when a backend is configured
- runtime-controlled local workspace execution is implemented through backend-returned `workspace_actions`
- focused verification commands can be executed locally through the runtime allowlist
- autonomy policy limits are enforced for file count, diff size, and high-risk paths
- actual local code editing is now available either through a privileged `command` backend or through runtime-applied `workspace_actions`

## Phase 4. Critic And Validation Loop

Status: partially shipped

### Outcome

Add the quality loop that decides whether work continues, retries, or escalates.

### Scope

- implement `CriticAgent`
- implement `ValidationAgent`
- classify failures
- create retry and escalation policies
- wrap existing validators and test runners

### Suggested landing areas

- `src/agents/critic/CriticAgent.ts`
- `src/agents/validation/ValidationAgent.ts`
- `src/core/runtime/validation/ValidationRunner.ts`
- `src/core/runtime/validation/ValidationClassifier.ts`
- `src/core/runtime/orchestration/EscalationPolicy.ts`

### Stories

- Persist critic reports and validation artifacts
- Add failure classification enum handling
- Create new execution cycles on retry
- Add `osj agent run critic`
- Add `osj agent run validation`
- Add `osj orchestrate --until validation`

### Done when

- a failed validation creates either a retry cycle or an approval request
- runtime explains exactly why it retried or stopped

### Current landing

- critic and validation artifacts are persisted
- failure classification is implemented
- execution cycles are persisted and advanced through implementation, critic, and validation
- approval requests are now first-class runtime artifacts, but retry/escalation intelligence can still mature further

## Phase 5. Delivery And Governed Closure

Status: partially shipped

### Outcome

Complete the end-to-end cell with delivery artifacts and governed archive decisions.

### Scope

- implement `DeliveryAgent`
- prepare closure summary and Jira comment draft
- separate `archive_allowed` from `worklog_allowed`
- wire approvals into archive flow
- preserve `sync_pending` semantics

### Suggested landing areas

- `src/agents/delivery/DeliveryAgent.ts`
- `src/core/runtime/orchestration/ArchiveDecision.ts`
- `src/integrations/jira/JiraWorklogSync.ts`
- `src/integrations/jira/JiraCommentWriter.ts`
- `src/cli/index.ts` for approvals and orchestration auto mode

### Stories

- Persist `closure-summary.json`
- Add `osj agent run delivery`
- Add `osj approval show|accept|reject`
- Add `osj orchestrate --auto`
- Ensure archive can be blocked while worklog evidence remains intact

### Done when

- validated work can produce a delivery summary and approval request
- archive decisions are inspectable and recoverable
- Jira sync failures preserve runtime closure evidence

### Current landing

- `DeliveryAgent` persists closure summary and archive decision artifacts
- approval artifacts and CLI commands are implemented
- `osj archive` now obeys runtime archive governance for runtime-managed changes
- worklog allowance is modeled separately from archive allowance in delivery artifacts
- outbound Jira comment publication remains a later integration step

## Phase 6. Observability And Learning

### Outcome

Turn runtime history into operational analytics and autonomy feedback.

### Scope

- metrics per agent, cycle, and session
- autonomy score inputs
- rework and stability analytics
- export or reporting hooks for future planning

### Suggested landing areas

- `src/core/runtime/telemetry/TelemetryManager.ts`
- `src/core/runtime/telemetry/MetricsCollector.ts`
- `src/core/runtime/telemetry/AutonomyScore.ts`
- future dashboards or report commands

### Stories

- persist time spent per block and cycle
- persist retry counts and failure classifications
- calculate first-pass autonomy score inputs
- expose `osj runtime graph` and richer `status` views

### Done when

- the runtime can explain how a ticket was delivered, not just whether it was delivered

## Recommended Command Rollout

Ship commands in this order:

1. `osj runtime status`
2. `osj runtime explain`
3. `osj agent run context`
4. `osj agent run spec`
5. `osj agent run planning`
6. `osj agent run implementation`
7. `osj agent run critic`
8. `osj agent run validation`
9. `osj agent run delivery`
10. `osj approval show|accept|reject`
11. `osj orchestrate --from-session`
12. `osj orchestrate --until <stage>`
13. `osj orchestrate --auto`

## Testing Strategy By Phase

| Phase | Minimum test coverage |
| --- | --- |
| 1 | runtime state transitions, store persistence, CLI status output |
| 2 | context/spec/plan artifact generation and deterministic paths |
| 3 | policy guards, implementation report persistence, changed-file limits |
| 4 | retry logic, failure classification, escalation creation |
| 5 | archive readiness decisions, Jira sync recovery, approval flows |
| 6 | telemetry aggregation and autonomy score input correctness |

## First Concrete Milestone

If implementation time is tight, the first milestone should be:

```text
runtime-aware multi-agent loop
```

With these minimum visible features:

- runtime state formalized
- context pack generation
- planning artifact generation
- implementation run adapter
- critic report
- validation result
- archive-readiness decision

That milestone is the first point where `osj` clearly behaves like an agentic delivery runtime rather than only a timer-enhanced CLI.
