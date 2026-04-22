# Agent Contracts

See also: [ARCHITECTURE](./ARCHITECTURE.md), [STATE-MACHINES](./STATE-MACHINES.md), [AGENT-BACKENDS](./AGENT-BACKENDS.md), [AUTONOMY-POLICY](./AUTONOMY-POLICY.md), [CURRENT-IMPLEMENTATION](./CURRENT-IMPLEMENTATION.md)

## Purpose

Each agent receives a common runtime envelope plus role-specific inputs, and returns a structured result plus durable artifacts. This document defines those contracts so orchestration can stay deterministic.

## Core Rules

1. Every agent run must be addressable by `agent_run_id`.
2. Every agent receives explicit permissions; no agent infers capabilities from its name.
3. Every important output must be persisted as an artifact or event.
4. Every run must recommend the next action, even when it fails or escalates.
5. The orchestrator, not the agent, owns retry decisions and final state transitions.

## Shared TypeScript Interfaces

```ts
export interface AgentConstraints {
  canReadJira: boolean;
  canEditSpecs: boolean;
  canEditCode: boolean;
  canRunValidation: boolean;
  canCommentJira: boolean;
  canArchive: boolean;
  maxFilesToEdit?: number;
  maxDiffLines?: number;
  highRiskPaths?: string[];
}

export interface AgentBudget {
  maxMinutes?: number;
  maxTokens?: number;
  maxRetriesRemaining?: number;
}

export interface RuntimeEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  payload: unknown;
}

export interface AgentRunEnvelope {
  run_id: string;
  agent_name: string;
  ticket_key: string;
  session_id: string;
  cycle_id: string;
  change_name?: string;
  autonomy_level: 'L0_OBSERVE' | 'L1_DRAFT' | 'L2_ASSISTED' | 'L3_SUPERVISED_AUTONOMY' | 'L4_HIGH_AUTONOMY';
  workspace_root: string;
  input_refs: string[];
  constraints: AgentConstraints;
  budget?: AgentBudget;
}

export interface AgentContext {
  repo_root: string;
  runtime_root: string;
  ticket_state: string;
  session_state: string;
  change_state?: string;
  cycle_state?: string;
  readRef(ref: string): Promise<string>;
  emit(event: RuntimeEvent): Promise<void>;
}

export interface AgentResultEnvelope<TOutput> {
  agent_name: string;
  status: 'SUCCEEDED' | 'FAILED' | 'ESCALATED' | 'REJECTED' | 'SKIPPED';
  output: TOutput;
  artifact_refs: string[];
  human_questions?: string[];
  recommended_next_action: NextAction;
}

export interface Agent<Input, Output> {
  name: string;
  canRun(context: AgentContext): Promise<boolean>;
  run(input: Input, context: AgentContext): Promise<AgentResultEnvelope<Output>>;
}
```

## Common Runtime Envelope

All agents receive this baseline payload shape:

```json
{
  "run_id": "run_123",
  "agent_name": "spec_agent",
  "ticket_key": "PROJ-123",
  "session_id": "sess_001",
  "cycle_id": "cyc_001",
  "autonomy_level": "L2_ASSISTED",
  "workspace_root": "/repo",
  "change_name": "implement-worklog-sync",
  "input_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/context/normalized-context.json",
    "openspec/changes/implement-worklog-sync/jira-ticket.md"
  ],
  "constraints": {
    "canReadJira": true,
    "canEditSpecs": true,
    "canEditCode": false,
    "canRunValidation": false,
    "canCommentJira": false,
    "canArchive": false
  },
  "budget": {
    "maxMinutes": 15,
    "maxRetriesRemaining": 2
  }
}
```

## Next Action Enum

The orchestrator should consume a closed set of next actions:

```ts
type NextAction =
  | 'RUN_CONTEXT_AGENT'
  | 'RUN_SPEC_AGENT'
  | 'RUN_PLANNING_AGENT'
  | 'RUN_IMPLEMENTATION_AGENT'
  | 'RUN_CRITIC_AGENT'
  | 'RUN_VALIDATION_AGENT'
  | 'RUN_DELIVERY_AGENT'
  | 'REQUEST_HUMAN_APPROVAL'
  | 'REQUEST_ARCHIVE_APPROVAL'
  | 'OPEN_RECOVERY_FLOW'
  | 'STOP';
```

## Agent Catalog

| Agent | Responsibility | Side effects |
| --- | --- | --- |
| `ContextAgent` | Normalize Jira + repo + artifact context | runtime context artifacts only |
| `SpecAgent` | Generate or update OpenSpec change artifacts | OpenSpec files and spec summaries |
| `PlanningAgent` | Produce execution plan and test strategy | planning artifacts only |
| `ImplementationAgent` | Apply code and test changes within policy | working tree + implementation report |
| `CriticAgent` | Review diff, assumptions, and plan adherence | review artifacts only |
| `ValidationAgent` | Execute checks and classify results | validation artifacts only |
| `DeliveryAgent` | Prepare closure summary, Jira draft, archive readiness | delivery artifacts and approval request seeds |

## 1. Context Agent

### Inputs

- Jira issue payload
- active session metadata
- existing OpenSpec artifacts, if any
- repo metadata and current branch

### Output Contract

```json
{
  "agent_name": "context_agent",
  "status": "SUCCEEDED",
  "output": {
    "normalized_context": {
      "problem_statement": "...",
      "acceptance_criteria": [],
      "business_rules": [],
      "data_contracts": [],
      "integrations": [],
      "out_of_scope": [],
      "ambiguities": [],
      "risks": []
    }
  },
  "artifact_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/context/normalized-context.json",
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/context/context-summary.md"
  ],
  "human_questions": [],
  "recommended_next_action": "RUN_SPEC_AGENT"
}
```

## 2. Spec Agent

### Inputs

- normalized context
- Jira description and acceptance criteria
- existing `proposal.md`, `tasks.md`, `jira-ticket.md`, `spec.md`, if present

### Output Contract

```json
{
  "agent_name": "spec_agent",
  "status": "SUCCEEDED",
  "output": {
    "change_name": "implement-worklog-sync",
    "created_files": [
      "openspec/changes/implement-worklog-sync/proposal.md",
      "openspec/changes/implement-worklog-sync/tasks.md",
      "openspec/changes/implement-worklog-sync/jira-ticket.md",
      "openspec/changes/implement-worklog-sync/specs/implement-worklog-sync/spec.md"
    ],
    "scenarios_generated": 6,
    "ambiguities_remaining": 1
  },
  "artifact_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/spec/spec-diff-summary.md"
  ],
  "recommended_next_action": "RUN_PLANNING_AGENT"
}
```

## 3. Planning Agent

### Inputs

- normalized context
- OpenSpec change artifacts
- repo tree and code hotspots
- optional prior validation/review history

### Output Contract

```json
{
  "agent_name": "planning_agent",
  "status": "SUCCEEDED",
  "output": {
    "execution_plan": {
      "objective": "Implement automatic Jira worklog creation on archive",
      "steps": [
        { "id": "P1", "title": "Add session sync service", "owner": "implementation_agent" },
        { "id": "P2", "title": "Add worklog payload builder", "owner": "implementation_agent" },
        { "id": "P3", "title": "Add integration tests", "owner": "implementation_agent" }
      ],
      "files_likely_affected": [
        "src/core/archive.ts",
        "src/core/timer/commands.ts",
        "src/core/timer/worklog-payload.ts"
      ],
      "test_strategy": ["unit_tests", "integration_tests"],
      "rollback_strategy": "feature_flag_or_cli_guard",
      "estimated_risk": "medium"
    }
  },
  "artifact_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/planning/execution-plan.json",
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/planning/execution-plan.md"
  ],
  "recommended_next_action": "REQUEST_HUMAN_APPROVAL"
}
```

## 4. Implementation Agent

### Inputs

- approved execution plan
- OpenSpec artifacts
- codebase and tests
- capability constraints and risk guards

### Output Contract

```json
{
  "agent_name": "implementation_agent",
  "status": "SUCCEEDED",
  "output": {
    "changes_applied": [
      {
        "file": "src/core/archive.ts",
        "change_type": "modified",
        "summary": "Added archive readiness check before Jira sync"
      }
    ],
    "tasks_completed": ["P1", "P2"],
    "tasks_remaining": ["P3"],
    "tests_added": ["test/core/runtime/archive-readiness.test.ts"],
    "known_limitations": [],
    "backend_invocation": {
      "configured": true,
      "backend_name": "shared",
      "mode": "openai_compatible",
      "status": "EXECUTED"
    },
    "workspace_execution": {
      "status": "APPLIED",
      "applied_actions": 3,
      "blocked_actions": 0,
      "file_actions": 2,
      "command_actions": 1,
      "touched_files": [
        "src/core/archive.ts",
        "test/core/runtime/archive-readiness.test.ts"
      ],
      "command_results": [
        {
          "command": ["node", "--test", "test/core/runtime/archive-readiness.test.ts"],
          "exit_code": 0,
          "stdout": "...",
          "stderr": ""
        }
      ],
      "errors": []
    }
  },
  "artifact_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/implementation/change-report.json"
  ],
  "recommended_next_action": "RUN_CRITIC_AGENT"
}
```

### Current Implementation Note

Today this agent is a bounded workspace adapter with pluggable backend routing. It inspects the active diff, test files, and task progress, and writes a structured implementation report. When configured, it also persists backend prompt/request/response artifacts and can apply runtime-controlled local workspace actions.

Supported connectivity modes today:

- `manual`
- `openai_compatible`
- `command`
- `anthropic_native`
- `gemini_native`

Backends can optionally return `workspace_actions` inside structured output. The runtime supports these actions today:

- `write_file`
- `replace_in_file`
- `delete_file`
- `run_command`

The runtime, not the backend, decides whether those actions actually execute.

## 5. Critic Agent

### Inputs

- current diff
- execution plan
- spec artifacts
- implementation report

### Output Contract

```json
{
  "agent_name": "critic_agent",
  "status": "SUCCEEDED",
  "output": {
    "review_result": "CHANGES_REQUESTED",
    "findings": [
      {
        "severity": "high",
        "type": "missing_validation",
        "file": "src/core/archive.ts",
        "message": "Archive path does not preserve sync_pending when Jira comment creation fails"
      }
    ]
  },
  "artifact_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/review/critic-report-001.json",
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/review/critic-report-001.md"
  ],
  "recommended_next_action": "RUN_IMPLEMENTATION_AGENT"
}
```

## 6. Validation Agent

### Inputs

- current codebase state
- test strategy
- raw test output
- critic report

### Output Contract

```json
{
  "agent_name": "validation_agent",
  "status": "SUCCEEDED",
  "output": {
    "validation_result": "FAILED",
    "checks": [
      { "name": "unit_tests", "status": "passed" },
      { "name": "integration_tests", "status": "failed" },
      { "name": "openspec_validate", "status": "passed" }
    ],
    "failure_classification": "RETRYABLE_IMPLEMENTATION_ERROR",
    "archive_eligible": false
  },
  "artifact_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/validation/validation-001.json"
  ],
  "recommended_next_action": "RUN_IMPLEMENTATION_AGENT"
}
```

### Failure Classification Enum

```ts
type FailureClassification =
  | 'PASSED'
  | 'RETRYABLE_IMPLEMENTATION_ERROR'
  | 'SPEC_AMBIGUITY'
  | 'ENVIRONMENT_FAILURE'
  | 'REQUIRES_HUMAN_DECISION'
  | 'NON_RECOVERABLE';
```

### Current Implementation Note

Today the validation loop wraps:

- `openspec validate` semantics through the existing delta validator
- critic approval state
- `tasks.md` completion state

It does not yet run a generalized test matrix or CI pipeline adapter.

## 7. Delivery Agent

### Inputs

- successful validation result
- task completion status
- work blocks and session summary
- Jira context

### Output Contract

```json
{
  "agent_name": "delivery_agent",
  "status": "SUCCEEDED",
  "output": {
    "archive_ready": true,
    "jira_comment": "Implemented automatic worklog creation on archive. Added retry-safe sync flow and integration tests.",
    "closure_summary": {
      "completed_scope": [],
      "remaining_risks": [],
      "worklog_preview": []
    }
  },
  "artifact_refs": [
    ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/delivery/closure-summary.json"
  ],
  "recommended_next_action": "REQUEST_ARCHIVE_APPROVAL"
}
```

### Current Implementation Note

Today `DeliveryAgent` produces:

- `closure-summary.json`
- `archive-decision.json`
- `closure-summary.md`

Under the default `L2_ASSISTED` autonomy level, it requests explicit archive approval instead of allowing direct closeout.

## Capability Matrix

| Agent | Read Jira | Edit specs | Edit code | Run tests | Comment Jira | Archive |
| --- | --- | --- | --- | --- | --- | --- |
| Context | Yes | No | No | No | No | No |
| Spec | Yes | Yes | No | No | No | No |
| Planning | Yes | Yes | No | No | No | No |
| Implementation | Yes | No | Yes | Optional | No | No |
| Critic | Yes | No | No | No | No | No |
| Validation | Yes | No | No | Yes | No | No |
| Delivery | Yes | Yes | No | No | Draft only | No |

## Event Contract

Each run should emit:

```json
{
  "event_id": "evt_001",
  "event_type": "AGENT_RUN_COMPLETED",
  "timestamp": "2026-04-21T17:00:00Z",
  "ticket_key": "PROJ-123",
  "session_id": "sess_001",
  "change_name": "implement-worklog-sync",
  "cycle_id": "cyc_002",
  "payload": {
    "agent_run_id": "run_123",
    "agent_name": "planning_agent",
    "status": "SUCCEEDED",
    "artifact_refs": [
      ".openspec/runtime/tickets/PROJ-123/changes/implement-worklog-sync/planning/execution-plan.json"
    ]
  }
}
```

## Contract Rule For Codex Integration

When the implementation agent is backed by Codex or another code-editing model:

- the adapter must receive only the files and permissions granted by policy
- the agent report must summarize what changed independent of the raw diff
- the orchestrator must store the report before moving to critique or validation
- failure to persist artifacts is a runtime failure even if code edits were applied
- the same backend abstraction should remain reusable by the other agents so connectivity stays uniform across the runtime
