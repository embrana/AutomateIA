# Critic Smoke Test Backlog

See also: [CURRENT-IMPLEMENTATION](./CURRENT-IMPLEMENTATION.md), [IMPLEMENTATION-BACKLOG](./IMPLEMENTATION-BACKLOG.md), [AGENT-BACKENDS](./AGENT-BACKENDS.md), [AUTONOMY-POLICY](./AUTONOMY-POLICY.md)

## Purpose

This document captures the results of a manual smoke test of the current `implementation -> critic -> validation` loop, with special focus on the new `CriticAgent` backend routing through:

- `gemini-review`
- `codex-review`

The goal is to preserve the operational findings as concrete backlog items rather than leaving them only in terminal output.

## Smoke Test Scope

The test verified:

- isolated `gemini-review-runner.mjs`
- isolated `codex-review-runner.mjs`
- integrated `osj agent run critic` with `agents.routing.critic = gemini-review`
- integrated `osj agent run critic` with `agents.routing.critic = codex-review`
- runtime artifact persistence under `.openspec/runtime/.../review/`

The test did **not** represent a clean end-to-end product implementation scenario because:

- the active Jira ticket `AA-70` does not map to this repository's implementation surface
- the workspace was already dirty
- planning approval remained pending while later stages still advanced

## High-Level Outcome

The smoke test passed for connectivity and routing:

- `CriticAgent` can now run against both Gemini CLI and Codex CLI through `command` backends
- runtime artifacts persist the selected backend identity and backend prompt/request/response data
- backend switching is controlled purely by config

The smoke test failed as a clean governance demonstration because multiple runtime issues were exposed.

## Model Comparison

### Shared behavior

Both models agreed on the high-level outcome:

- `review_result = CHANGES_REQUESTED`
- the implementation should not be accepted as a successful fulfillment of `AA-70`

Both reports also inherited the deterministic runtime findings:

- `policy_violation`
- `spec_ambiguity`
- `plan_drift`

### Gemini review

Observed strengths:

- correctly recognized that the ticket appears to belong to another product/repository
- produced useful human questions about repository mismatch and ticket migration
- behaved well as a read-only reviewer through Gemini CLI

Observed weaknesses:

- returned `CHANGES_REQUESTED` without structured findings
- forced the runtime to synthesize `backend_review_request`
- produced a weaker artifact for machine-driven retry logic because the semantic objection was not encoded as concrete findings

Assessment:

- Gemini is already viable as an alternate reviewer backend
- it is currently weaker than Codex for structured, artifact-level review output in this workflow

### Codex review

Observed strengths:

- produced explicit, structured findings with file-level evidence
- identified the key semantic failure modes:
  - `scope_mismatch`
  - `verification_gap`
  - `constraint_violation`
- produced a stronger artifact for downstream automation because the review is already encoded in runtime-friendly structure

Observed weaknesses:

- no major contract-level weakness surfaced in this smoke test
- still operated over a dirty workspace, so some findings were shaped by contaminated implementation evidence

Assessment:

- Codex is currently the stronger default `CriticAgent` backend for this repository
- Gemini remains useful, but needs a stricter output contract or stronger prompt shaping

### Recommendation

Current default recommendation:

- keep `codex-review` as the preferred reviewer backend for production use
- keep `gemini-review` as a supported alternate backend
- strengthen the Gemini critic contract so `CHANGES_REQUESTED` must include at least one structured finding

## Backlog

## P0

### P0-1. Orchestrator must not advance past pending planning approval

Problem:

- `osj orchestrate --until implementation` advanced into `implementation_agent` even though a `plan` approval artifact was still `PENDING`

Why it matters:

- this breaks the intended autonomy boundary
- the runtime can perform expensive or misleading downstream work after a stage that explicitly required human approval

Evidence:

- pending approval `approval-fd7f8d09-824d-44a7-acca-ebdd93ad31cf [plan]`
- later `implementation_agent` still executed and created implementation artifacts

Done when:

- `osj orchestrate --until <later-stage>` refuses to execute later agents while any blocking prior-stage approval remains unresolved
- terminal summary clearly reports the unresolved approval as the reason no later agent ran

### P0-2. Implementation scope assessment must not use full dirty-worktree diff as cycle evidence

Problem:

- `implementation_agent` recorded `diff_lines = 4415` and escalated on the full repository diff
- the active workspace already contained unrelated local changes

Why it matters:

- diff/file budget gating becomes noisy and misleading
- approvals may be created for pre-existing work rather than changes attributable to the current cycle

Evidence:

- `implementation/change-report.json`
- approval `approval-17a66945-6b03-4f56-9eb6-8f328f92538f [implementation]`

Done when:

- implementation scope is evaluated against a clean per-cycle baseline, not the entire dirty worktree
- the report distinguishes:
  - pre-existing changes
  - changes attributable to the current implementation run

### P0-3. Critic backend contract should fail closed on `CHANGES_REQUESTED` without findings

Problem:

- Gemini returned `review_result = CHANGES_REQUESTED` with no findings
- the runtime had to inject `backend_review_request`

Why it matters:

- machine-driven retries work better with structured causes than with synthetic fallback findings
- the current contract is too loose for reliable automation

Evidence:

- `/tmp/critic-gemini-report.json`
- `review/critic-report.json` with synthesized `backend_review_request`

Done when:

- either the backend prompt guarantees at least one finding for `CHANGES_REQUESTED`
- or the runtime treats missing findings as an invalid backend response and marks the backend invocation as failed/incomplete rather than semantically reviewed

## P1

### P1-1. Keep implementation report task completion aligned with actual artifact state

Problem:

- `implementation/change-report.json` marked `P1`, `P2`, and `P3` complete
- `tasks.md` still had core implementation and validation steps unchecked
- the same report stated that no verification command was run and that the requested product behavior was not implemented here

Why it matters:

- retry and delivery decisions become inconsistent
- later agents consume contradictory evidence

Evidence:

- `implementation/change-report.json`
- `openspec/changes/aa-70-wellness-revision-definiciones-inputs-outflow-pantallas-etc/tasks.md`
- Codex critic findings `scope_mismatch` and `verification_gap`

Done when:

- `ImplementationAgent` only marks plan steps complete when the corresponding task evidence is actually satisfied
- task completion heuristics no longer over-report implementation progress

### P1-2. Improve runtime explanation priority when multiple approvals exist

Problem:

- `osj runtime explain` stayed anchored on the pending planning approval
- the runtime had already progressed through implementation and critic, creating a more complex state than the explanation reflected

Why it matters:

- developers lose situational awareness in multi-approval states
- the explanation under-describes the real runtime path that occurred

Evidence:

- `osj runtime explain` after critic still prioritized planning approval only

Done when:

- `osj runtime explain` can summarize compound blocked state
- explanation highlights:
  - oldest unresolved approval
  - latest executed agent
  - latest escalation reason
  - most relevant artifact for next action

### P1-3. Strengthen Gemini reviewer prompt for structured runtime findings

Problem:

- Gemini's questions and limitations were useful, but they did not become machine-readable findings

Why it matters:

- the model clearly understood the mismatch, but the runtime could not fully use that understanding downstream

Evidence:

- Gemini output contained good human questions but no direct findings

Done when:

- the Gemini review runner or CriticAgent prompt explicitly instructs:
  - every semantic objection must be encoded as a finding
  - `human_questions` are supplemental, not a substitute for findings

## P2

### P2-1. Provide a first-class local smoke-test fixture mode without Jira dependency

Problem:

- current runtime testing still depends on a real active session shape
- manual smoke tests are possible, but awkward

Why it matters:

- backend and orchestration testing should be reproducible without Jira access
- contributors need a cleaner path to test routing, approvals, critic behavior, and validation loops

Candidate solution directions:

- `osj runtime seed-test-session`
- `osj runtime import-fixture <name>`
- checked-in local fixture payloads for ticket/session/change runtime state

Done when:

- a contributor can bootstrap a deterministic runtime test session locally with no Jira call

### P2-2. Add explicit reviewer comparison guidance to docs

Problem:

- reviewer backend choice is currently discoverable but not yet operationally documented with decision criteria

Why it matters:

- teams need guidance on when to prefer Codex vs Gemini for review

Done when:

- docs explain:
  - when to prefer `codex-review`
  - when to prefer `gemini-review`
  - what output quality trade-offs are currently known

## Suggested Issue Order

Recommended implementation order:

1. `P0-1` approval gating in orchestrator
2. `P0-2` dirty-worktree diff contamination
3. `P0-3` strict critic backend contract
4. `P1-1` implementation/task alignment
5. `P1-2` richer runtime explain
6. `P1-3` better Gemini critic prompt
7. `P2-1` local runtime fixture mode
8. `P2-2` reviewer selection guidance

## Operational Summary

What is already good:

- reviewer backend routing works
- Gemini CLI integration works
- Codex CLI integration works
- runtime review artifacts are durable and inspectable

What should block calling this slice "production-ready":

- approval gating bug
- dirty-worktree diff contamination
- weak fail-closed contract for Gemini-style semantic review outputs
