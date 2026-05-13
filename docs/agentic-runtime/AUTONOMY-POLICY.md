# Autonomy Policy

See also: [ARCHITECTURE](./ARCHITECTURE.md), [STATE-MACHINES](./STATE-MACHINES.md), [AGENT-CONTRACTS](./AGENT-CONTRACTS.md), [CURRENT-IMPLEMENTATION](./CURRENT-IMPLEMENTATION.md)

## Purpose

The runtime must be governable. This policy defines how much autonomy agents get, when human approval is required, and how retries, risk, and budget exhaustion trigger escalation.

## Default Operating Mode

The default operating mode for this repository should be:

```text
L2_ASSISTED
```

That means the runtime may generate artifacts, edit code, and run validations, but it must stop at explicit human checkpoints for higher-risk execution and final closure.

## Autonomy Levels

| Level | Meaning | Allowed | Requires human |
| --- | --- | --- | --- |
| `L0_OBSERVE` | analysis only | read Jira, normalize context, propose spec/plan | any file edits, Jira writes, archive |
| `L1_DRAFT` | artifact drafting | create draft OpenSpec artifacts, draft plan, draft Jira comment | code edits, live sync, archive |
| `L2_ASSISTED` | controlled execution | code edits, tests, validation, archive recommendation | high-risk plan approval, Jira external actions if configured, final archive approval |
| `L3_SUPERVISED_AUTONOMY` | bounded autonomous loop | iterative implement-review-validate cycles, limited retries, Jira comments, session close | business ambiguity, high-risk changes, budget overruns, critical archive decisions |
| `L4_HIGH_AUTONOMY` | near-end-to-end autonomy | full flow except exceptional cases | only explicit critical exceptions |

## Policy Inputs

The runtime should evaluate autonomy with these inputs:

- current autonomy level
- risk level of the ticket and affected files
- number of retries and failed validations
- scope size of the diff
- whether the issue is functionally ambiguous
- whether external side effects are about to happen
- whether manual approvals are already pending

## Escalate To A Human When

### Business ambiguity

- acceptance criteria contradict each other
- core functional behavior is under-specified
- multiple valid business interpretations remain

### High-risk change

- touches auth, payments, or production data migration paths
- changes security-sensitive behavior
- modifies destructive workflows or irreversible side effects

### Repeated failure

- retry budget is exhausted
- validation fails repeatedly with no convergence
- critic and validation outputs conflict with the planning baseline

### Budget exhaustion

- token budget exceeded
- time budget exceeded
- diff is larger than allowed for the current autonomy level

### Environment or consistency failure

- repository is in an inconsistent state
- runtime linkage is broken
- toolchain/test environment failure masks actual delivery state

## Baseline Thresholds

Recommended defaults:

```json
{
  "max_retry_cycles": 3,
  "max_failed_validations": 3,
  "max_changed_files_without_human_review": 20,
  "max_diff_lines_without_human_review": 800,
  "high_risk_paths": [
    "src/auth/**",
    "src/payments/**",
    "db/migrations/**"
  ],
  "always_escalate_when": [
    "business_ambiguity_detected",
    "non_recoverable_validation_error",
    "security_sensitive_area_changed"
  ]
}
```

These should live in runtime policy config, not hardcoded inside individual agents.

## Current Implementation Note

The current runtime slice already enforces these policy dimensions inside the `ImplementationAgent` adapter:

- changed file count
- estimated diff size
- high-risk path detection
- autonomy level guard for code changes
- runtime-managed blocking and escalation signals that feed approval requests

Approval artifacts and approval CLI are now implemented; archive approval is the most explicit delivered checkpoint today.

## Policy Matrix

| Situation | Runtime action |
| --- | --- |
| Ticket is clear, risk is low, diff is small | continue autonomously within budget |
| Spec ambiguity remains after context/spec generation | open approval or escalation |
| Validation fails once | retry through implementation loop |
| Validation fails 2-3 times | run critic + implementation again if budget remains |
| Validation fails more than 3 times | escalate to human |
| Change touches auth/payments/migrations | require explicit approval before implementation or archive |
| `tasks.md` incomplete but work time exists | preserve session/worklog evidence, block archive |
| Jira sync fails after archive | move session to `SYNC_PENDING` and preserve closure evidence |
| Session is `SYNC_PENDING` and OPSX wants to create a change | stop and require `osj archive --retry` or `osj timer cancel` first |
| Repo is dirty or inconsistent in a way the runtime cannot classify | enter recovery flow |

## Approval Model

Human checkpoints should be first-class runtime objects:

```ts
export interface ApprovalRequest {
  approval_id: string;
  ticket_key: string;
  session_id: string;
  change_name?: string;
  scope: 'plan' | 'implementation' | 'archive' | 'jira_comment' | 'recovery';
  reason: string;
  evidence_refs: string[];
  created_at: string;
  resolved_at?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
}
```

## Current Implementation Note

The repository now persists approval artifacts and exposes them through:

- `osj approval show`
- `osj approval accept <approval-id>`
- `osj approval reject <approval-id> --reason "..."`

Archive approval is currently the most explicit delivered use case.

The repository also exposes native OPSX session helpers that inherit the same governance model:

- `osj opsx track explore --json`
- `osj opsx track propose discovery --json`
- `osj opsx create-change <name>`
- `osj opsx track propose generation`
- `osj opsx track propose review`

These helpers make planning-time work visible in timer evidence by distinguishing collaborative `human_agent_interaction / spec` work from autonomous `ai_autonomous / spec` artifact generation.

### Approval Triggers

- `plan`: required when planning enters high-risk territory or ambiguity remains
- `implementation`: required before code edits in sensitive areas
- `archive`: required when archive is policy-blocked even though validation is green
- `jira_comment`: optional, if teams want outbound Jira comments reviewed
- `recovery`: required when the runtime cannot repair state automatically

## Retry Policy

The retry policy belongs to orchestration, not individual agents.

### Retryable classes

- `RETRYABLE_IMPLEMENTATION_ERROR`
- temporary test or CI flakiness with high confidence
- deterministic code defects discovered by critic/validation

### Non-retryable classes

- `SPEC_AMBIGUITY`
- `REQUIRES_HUMAN_DECISION`
- `NON_RECOVERABLE`
- high-risk scope entered without approval

### Retry Rules

1. create a new execution cycle for each retry
2. carry forward plan, context, and previous findings as inputs
3. stop retrying when either retry budget or failed-validation budget is exhausted
4. emit an escalation artifact before moving to `AWAITING_HUMAN`

## Archive And Jira Side-Effect Policy

Archive and Jira sync are related but distinct:

- archive may be allowed while Jira comment creation is not
- worklog sync may succeed even when archive is blocked
- archive readiness requires validated work plus policy clearance
- Jira side effects must not erase or overwrite runtime evidence if they fail

This is important because the current `osj` flow already models `sync_pending`; the multi-agent runtime should preserve that design.

## Governance Commands

The runtime should expose approvals explicitly:

```text
osj approval show
osj approval accept <approval-id>
osj approval reject <approval-id> --reason "..."
```

`osj runtime explain` should also surface why the runtime stopped, which policy triggered, and which evidence artifacts support the decision.

For OPSX-driven planning flows, `osj runtime explain` should stay consistent with the `osj opsx ...` helpers so developers can see whether the runtime stopped because of paused state, `sync_pending`, policy budget, or approval gating.

## Risk Classification

Use a simple first-pass classifier:

| Risk | Typical signals |
| --- | --- |
| `low` | docs, isolated UI copy, narrow CLI behavior, small testable diff |
| `medium` | cross-module code changes, archive/worklog side effects, broader refactors |
| `high` | auth, payments, production data handling, destructive migrations, security-sensitive paths |

Risk should be computed from both ticket context and changed files. A low-risk ticket can still become a high-risk execution if the implementation touches sensitive areas.

## Autonomy Score Inputs

The runtime should capture these from the beginning:

- percentage of tickets closed without escalation
- number of rework cycles
- number of failed validations
- human acceptance without requested changes
- deviation between plan and actual implementation

Suggested conceptual formula:

```text
Autonomy Score = quality * completeness * stability * low_escalation
```

The actual scoring algorithm can remain simple at first; the important part is persisting the inputs.
