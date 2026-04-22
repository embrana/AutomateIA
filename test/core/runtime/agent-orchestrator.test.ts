import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { saveGlobalConfig } from '../../../src/core/global-config.js';
import { purpose } from '../../../src/core/timer/commands.js';
import { AgentOrchestrator } from '../../../src/core/runtime/orchestration/AgentOrchestrator.js';
import { ApprovalManager } from '../../../src/core/runtime/approvals/ApprovalManager.js';
import { RuntimeStore } from '../../../src/storage/fs/RuntimeStore.js';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('AgentOrchestrator', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-agent-runtime-test-')));
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    process.chdir(tempDir);
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config-home');

    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://example.atlassian.net',
        email: 'dev@example.com',
        api_token: 'token',
      },
      worklog: {
        rounding: 'minute',
        min_seconds: 60,
        comment_template: 'OpenSpec execution session',
        track_metadata_locally: true,
      },
    });

    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.chdir(originalCwd);
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('orchestrates context, spec, and planning artifacts from an active session', async () => {
    vi.useRealTimers();
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement runtime-aware planning flow',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: `## Context

The runtime should generate context and planning artifacts.

## Acceptance Criteria

### CA-1 - Create normalized context
The system stores normalized context in runtime artifacts.

### CA-2 - Produce execution plan
The system produces an execution plan before implementation.

## Business Rules

- Do not modify product code in this phase.
`,
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    const orchestrator = new AgentOrchestrator();
    const results = await orchestrator.orchestrateUntil('planning');

    expect(results).toHaveLength(3);
    expect(results.map((item) => item.agent)).toEqual(['context_agent', 'spec_agent', 'planning_agent']);
    expect(results.every((item) => item.status === 'SUCCEEDED')).toBe(true);

    const runtimeStore = new RuntimeStore();
    const sessionRuntime = await runtimeStore.getSessionRuntime('PROJ-123');
    const ticketRuntime = await runtimeStore.getTicketRuntime('PROJ-123');

    expect(sessionRuntime?.change_name).toBeTruthy();
    expect(ticketRuntime?.state).toBe('PLANNED');

    const changeName = sessionRuntime!.change_name!;
    const contextArtifact = path.join(tempDir, '.openspec', 'runtime', 'tickets', 'PROJ-123', 'context', 'normalized-context.json');
    const planningArtifact = path.join(tempDir, '.openspec', 'runtime', 'tickets', 'PROJ-123', 'changes', changeName, 'planning', 'execution-plan.json');
    const changeSpec = path.join(tempDir, 'openspec', 'changes', changeName, 'specs', changeName, 'spec.md');

    expect(JSON.parse(await fs.readFile(contextArtifact, 'utf-8'))).toMatchObject({
      problem_statement: 'The runtime should generate context and planning artifacts.',
    });
    expect(JSON.parse(await fs.readFile(planningArtifact, 'utf-8'))).toMatchObject({
      objective: 'Implement runtime-aware planning flow',
      test_strategy: ['unit_tests', 'integration_tests', 'openspec_validate'],
    });
    expect(await fs.readFile(changeSpec, 'utf-8')).toContain('## ADDED Requirements');
  });

  it('marks ambiguity when the Jira ticket does not include structured SDD sections', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-456',
      fields: {
        summary: 'Investigate planning runtime behavior',
        status: { name: 'To Do' },
        assignee: null,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Need a way to inspect runtime status and maybe generate a plan.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-456', { importTicket: true });
    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.runAgent('context_agent');

    expect(result.status).toBe('SUCCEEDED');

    const contextArtifact = path.join(tempDir, '.openspec', 'runtime', 'tickets', 'PROJ-456', 'context', 'normalized-context.json');
    const normalized = JSON.parse(await fs.readFile(contextArtifact, 'utf-8'));
    expect(normalized.ambiguities).toEqual(
      expect.arrayContaining(['Acceptance criteria were inferred from an unstructured Jira description.'])
    );
  });

  it('runs the implementation, critic, and validation loop with persisted cycle state', async () => {
    vi.useRealTimers();
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'feature.ts'), 'export const runtimeFlag = false;\n', 'utf-8');
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email dev@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "OpenSpec Tests"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });

    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-789',
      fields: {
        summary: 'Implement validation-ready runtime loop',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: `## Context

We need a runtime loop that reaches validation with persisted artifacts.

## Acceptance Criteria

### CA-1 - Track cycle state
The runtime stores execution cycle state transitions.

### CA-2 - Produce validation artifacts
The runtime stores critic and validation artifacts for the active change.

## Business Rules

- Avoid destructive repository actions in the implementation adapter.
`,
      },
    }));

    await purpose('PROJ-789', { importTicket: true });
    const orchestrator = new AgentOrchestrator();
    const planningResults = await orchestrator.orchestrateUntil('planning');
    expect(planningResults.at(-1)?.recommended_next_action).toBe('RUN_IMPLEMENTATION_AGENT');

    const runtimeStore = new RuntimeStore();
    const sessionRuntime = await runtimeStore.getSessionRuntime('PROJ-789');
    const changeName = sessionRuntime?.change_name;
    expect(changeName).toBeTruthy();

    await fs.writeFile(path.join(tempDir, 'src', 'feature.ts'), 'export const runtimeFlag = true;\n', 'utf-8');
    await fs.mkdir(path.join(tempDir, 'test'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'test', 'feature.test.ts'), 'export const runtimeFeatureTest = true;\n', 'utf-8');
    await fs.writeFile(
      path.join(tempDir, 'openspec', 'changes', changeName!, 'tasks.md'),
      '## 1. Runtime Loop\n\n- [x] 1.1 Review ticket\n- [x] 1.2 Implement runtime loop\n- [x] 1.3 Validate runtime loop\n',
      'utf-8'
    );

    const results = await orchestrator.orchestrateUntil('validation');
    expect(results.map((item) => item.agent)).toEqual([
      'implementation_agent',
      'critic_agent',
      'validation_agent',
    ]);
    expect(results.at(-1)?.recommended_next_action).toBe('RUN_DELIVERY_AGENT');

    const ticketRuntime = await runtimeStore.getTicketRuntime('PROJ-789');
    const changeRuntime = await runtimeStore.getChangeRuntime('PROJ-789', changeName!);
    const cycle = await runtimeStore.getExecutionCycle('PROJ-789', changeName!, 'cycle-001');

    expect(ticketRuntime?.state).toBe('READY_FOR_ARCHIVE');
    expect(changeRuntime?.state).toBe('VALIDATED');
    expect(changeRuntime?.validation_status).toBe('PASSED');
    expect(cycle?.state).toBe('PASSED');

    const implementationArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-789',
      'changes',
      changeName!,
      'implementation',
      'change-report.json'
    );
    const criticArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-789',
      'changes',
      changeName!,
      'review',
      'critic-report.json'
    );
    const validationArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-789',
      'changes',
      changeName!,
      'validation',
      'validation-result.json'
    );

    expect(JSON.parse(await fs.readFile(implementationArtifact, 'utf-8'))).toMatchObject({
      changes_applied: expect.arrayContaining([
        expect.objectContaining({ file: 'src/feature.ts' }),
      ]),
      tests_added: ['test/feature.test.ts'],
    });
    expect(JSON.parse(await fs.readFile(criticArtifact, 'utf-8'))).toMatchObject({
      review_result: 'APPROVED',
    });
    expect(JSON.parse(await fs.readFile(validationArtifact, 'utf-8'))).toMatchObject({
      validation_result: 'PASSED',
      archive_eligible: true,
    });
  });

  it('routes implementation through a manual backend and persists prompt artifacts', async () => {
    vi.useRealTimers();
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://example.atlassian.net',
        email: 'dev@example.com',
        api_token: 'token',
      },
      worklog: {
        rounding: 'minute',
        min_seconds: 60,
        comment_template: 'OpenSpec execution session',
        track_metadata_locally: true,
      },
      agents: {
        routing: {
          implementation: 'manual-draft',
        },
        backends: {
          'manual-draft': {
            mode: 'manual',
            model: 'gpt-5.4-mini',
          },
        },
      },
    });

    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-901',
      fields: {
        summary: 'Prepare implementation handoff prompt',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: `## Context

We need implementation guidance that can be handed off to an external coding model.

## Acceptance Criteria

### CA-1 - Prepare implementation prompt
The runtime persists a prompt artifact for the implementation step.

## Business Rules

- Do not auto-archive in this phase.
`,
      },
    }));

    await purpose('PROJ-901', { importTicket: true });
    const orchestrator = new AgentOrchestrator();
    const results = await orchestrator.orchestrateUntil('implementation');

    expect(results.map((item) => item.agent)).toEqual([
      'context_agent',
      'spec_agent',
      'planning_agent',
      'implementation_agent',
    ]);
    expect(results.at(-1)?.status).toBe('ESCALATED');
    expect(results.at(-1)?.recommended_next_action).toBe('REQUEST_HUMAN_APPROVAL');

    const runtimeStore = new RuntimeStore();
    const changeName = (await runtimeStore.getSessionRuntime('PROJ-901'))?.change_name;
    expect(changeName).toBeTruthy();

    const implementationArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-901',
      'changes',
      changeName!,
      'implementation',
      'change-report.json'
    );
    const backendPromptArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-901',
      'changes',
      changeName!,
      'implementation',
      'backend-prompt.md'
    );

    expect(JSON.parse(await fs.readFile(implementationArtifact, 'utf-8'))).toMatchObject({
      backend_invocation: {
        configured: true,
        backend_name: 'manual-draft',
        mode: 'manual',
        status: 'PREPARED',
      },
    });
    const implementationReport = JSON.parse(await fs.readFile(implementationArtifact, 'utf-8'));
    const backendPrompt = await fs.readFile(backendPromptArtifact, 'utf-8');

    expect(backendPrompt).toContain('# Implementation Backend Prompt');
    expect(backendPrompt).toContain('## Task Prompt');
    expect(backendPrompt).not.toContain('# Likely Affected File Contents');
    expect(backendPrompt).toContain('# Artifact Refs');
    expect(implementationReport.backend_invocation.request_payload.metadata).toMatchObject({
      execution_plan_step_ids: ['P1', 'P2', 'P3'],
    });
    expect(implementationReport.backend_invocation.request_payload.metadata).not.toHaveProperty('normalized_context');
    expect(implementationReport.backend_invocation.request_payload.metadata).not.toHaveProperty('execution_plan');

    const approvalManager = new ApprovalManager();
    const approvals = await approvalManager.listPendingApprovals('PROJ-901', changeName!, 'implementation');
    expect(approvals).toHaveLength(1);
  });

  it('applies backend workspace actions locally and runs focused tests', async () => {
    vi.useRealTimers();
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'runtime-worker.mjs'), 'export const runtimeWorker = false;\n', 'utf-8');
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email dev@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "OpenSpec Tests"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });

    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://example.atlassian.net',
        email: 'dev@example.com',
        api_token: 'token',
      },
      worklog: {
        rounding: 'minute',
        min_seconds: 60,
        comment_template: 'OpenSpec execution session',
        track_metadata_locally: true,
      },
      agents: {
        routing: {
          implementation: 'hosted-coder',
        },
        backends: {
          'hosted-coder': {
            mode: 'openai_compatible',
            base_url: 'https://llm.example.com',
            model: 'gpt-test',
            api_key_env: 'OPENAI_API_KEY',
          },
        },
      },
    });
    process.env.OPENAI_API_KEY = 'secret-key';

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        key: 'PROJ-902',
        fields: {
          summary: 'Apply backend workspace actions',
          status: { name: 'In Progress' },
          assignee: { displayName: 'Emiliano' },
          description: `## Context

The runtime should be able to apply backend-proposed workspace actions locally.

## Acceptance Criteria

### CA-1 - Apply local file edits
Implementation can modify local files through runtime-controlled actions.

### CA-2 - Run focused tests
Implementation can run a focused test command after applying the edits.

## Business Rules

- Keep the change within one source file and one targeted test.
`,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: 'applied',
                summary: 'Updated runtime worker and added a focused test.',
                files_touched: ['src/runtime-worker.mjs', 'test/runtime-worker.test.mjs'],
                tests_added: ['test/runtime-worker.test.mjs'],
                limitations: [],
                human_questions: [],
                workspace_actions: [
                  {
                    type: 'replace_in_file',
                    path: 'src/runtime-worker.mjs',
                    old: 'export const runtimeWorker = false;\n',
                    new: 'export const runtimeWorker = true;\n',
                  },
                  {
                    type: 'write_file',
                    path: 'test/runtime-worker.test.mjs',
                    content: [
                      "import test from 'node:test';",
                      "import assert from 'node:assert/strict';",
                      "import { runtimeWorker } from '../src/runtime-worker.mjs';",
                      "test('runtime worker flag', () => {",
                      '  assert.equal(runtimeWorker, true);',
                      '});',
                      '',
                    ].join('\n'),
                  },
                  {
                    type: 'run_command',
                    command: ['node', '--test', 'test/runtime-worker.test.mjs'],
                    reason: 'Run focused runtime worker test',
                  },
                ],
              }),
            },
          },
        ],
      }));

    await purpose('PROJ-902', { importTicket: true });
    const orchestrator = new AgentOrchestrator();
    const results = await orchestrator.orchestrateUntil('implementation');

    expect(results.map((item) => item.agent)).toEqual([
      'context_agent',
      'spec_agent',
      'planning_agent',
      'implementation_agent',
    ]);
    expect(results.at(-1)?.status).toBe('SUCCEEDED');
    expect(results.at(-1)?.recommended_next_action).toBe('RUN_CRITIC_AGENT');

    const runtimeStore = new RuntimeStore();
    const changeName = (await runtimeStore.getSessionRuntime('PROJ-902'))?.change_name;
    expect(changeName).toBeTruthy();

    expect(await fs.readFile(path.join(tempDir, 'src', 'runtime-worker.mjs'), 'utf-8')).toContain('true');
    expect(await fs.readFile(path.join(tempDir, 'test', 'runtime-worker.test.mjs'), 'utf-8')).toContain('runtimeWorker');

    const implementationArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-902',
      'changes',
      changeName!,
      'implementation',
      'change-report.json'
    );
    expect(JSON.parse(await fs.readFile(implementationArtifact, 'utf-8'))).toMatchObject({
      workspace_execution: {
        status: 'APPLIED',
        applied_actions: 3,
        command_actions: 1,
      },
      changes_applied: expect.arrayContaining([
        expect.objectContaining({ file: 'src/runtime-worker.mjs' }),
        expect.objectContaining({ file: 'test/runtime-worker.test.mjs' }),
      ]),
      tests_added: ['test/runtime-worker.test.mjs'],
    });
  });

  it('runs delivery, creates archive approval, and resumes archive readiness after approval', async () => {
    vi.useRealTimers();
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'delivery.ts'), 'export const deliveryFlag = false;\n', 'utf-8');
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email dev@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "OpenSpec Tests"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });

    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-900',
      fields: {
        summary: 'Prepare governed archive delivery runtime',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: `## Context

We need governed archive delivery with explicit approvals.

## Acceptance Criteria

### CA-1 - Create delivery decision
The runtime stores a delivery decision before archive.

### CA-2 - Require archive approval
The runtime creates an approval artifact before archive when autonomy is assisted.

## Business Rules

- Worklog evidence must survive even when archive is blocked.
`,
      },
    }));

    await purpose('PROJ-900', { importTicket: true });
    const orchestrator = new AgentOrchestrator();
    const planningResults = await orchestrator.orchestrateUntil('planning');
    expect(planningResults.at(-1)?.recommended_next_action).toBe('RUN_IMPLEMENTATION_AGENT');

    const runtimeStore = new RuntimeStore();
    const changeName = (await runtimeStore.getSessionRuntime('PROJ-900'))?.change_name;
    expect(changeName).toBeTruthy();

    await fs.writeFile(path.join(tempDir, 'src', 'delivery.ts'), 'export const deliveryFlag = true;\n', 'utf-8');
    await fs.mkdir(path.join(tempDir, 'test'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'test', 'delivery.test.ts'), 'export const deliveryTest = true;\n', 'utf-8');
    await fs.writeFile(
      path.join(tempDir, 'openspec', 'changes', changeName!, 'tasks.md'),
      '## 1. Governed Closeout\n\n- [x] 1.1 Prepare closure\n- [x] 1.2 Validate change\n- [x] 1.3 Request archive approval\n',
      'utf-8'
    );

    const results = await orchestrator.orchestrateUntil('delivery');
    expect(results.map((item) => item.agent)).toEqual([
      'implementation_agent',
      'critic_agent',
      'validation_agent',
      'delivery_agent',
    ]);
    expect(results.at(-1)?.recommended_next_action).toBe('REQUEST_ARCHIVE_APPROVAL');

    const ticketRuntime = await runtimeStore.getTicketRuntime('PROJ-900');
    const sessionRuntime = await runtimeStore.getSessionRuntime('PROJ-900');
    const changeRuntime = await runtimeStore.getChangeRuntime('PROJ-900', changeName!);
    expect(ticketRuntime?.state).toBe('HUMAN_ESCALATION_REQUIRED');
    expect(sessionRuntime?.state).toBe('AWAITING_HUMAN');
    expect(changeRuntime?.state).toBe('VALIDATED');
    expect(changeRuntime?.archive_eligible).toBe(false);
    expect(changeRuntime?.worklog_eligible).toBe(true);

    const approvalManager = new ApprovalManager();
    const approvals = await approvalManager.listPendingApprovals('PROJ-900', changeName!, 'archive');
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.scope).toBe('archive');

    const deliveryDecisionArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-900',
      'changes',
      changeName!,
      'delivery',
      'archive-decision.json'
    );
    expect(JSON.parse(await fs.readFile(deliveryDecisionArtifact, 'utf-8'))).toMatchObject({
      archive_ready: true,
      archive_allowed: false,
      worklog_allowed: true,
      approval_id: approvals[0]?.approval_id,
    });

    await approvalManager.resolveApproval(approvals[0]!.approval_id, 'APPROVED', 'Archive approved by reviewer');

    expect((await runtimeStore.getTicketRuntime('PROJ-900'))?.state).toBe('READY_FOR_ARCHIVE');
    expect((await runtimeStore.getSessionRuntime('PROJ-900'))?.state).toBe('ACTIVE');
    expect((await runtimeStore.getChangeRuntime('PROJ-900', changeName!))?.archive_eligible).toBe(true);
  });

  it('ignores active change scaffold files when evaluating implementation diff budget', async () => {
    vi.useRealTimers();
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email dev@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "OpenSpec Tests"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });

    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://example.atlassian.net',
        email: 'dev@example.com',
        api_token: 'token',
      },
      worklog: {
        rounding: 'minute',
        min_seconds: 60,
        comment_template: 'OpenSpec execution session',
        track_metadata_locally: true,
      },
      agents: {
        default_backend: 'implementation-api',
        backends: {
          'implementation-api': {
            mode: 'openai_compatible',
            base_url: 'https://example.com',
            model: 'gpt-test',
            api_key_env: 'OPENAI_API_KEY',
          },
        },
      },
    });
    process.env.OPENAI_API_KEY = 'secret-key';

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        key: 'PROJ-903',
        fields: {
          summary: 'Ignore active change scaffold in implementation policy',
          status: { name: 'In Progress' },
          assignee: { displayName: 'Emiliano' },
          description: `## Context

We need implementation policy to ignore the active change scaffold.

## Acceptance Criteria

### CA-1 - Ignore scaffold diff
The implementation budget excludes files created under the active change scaffold.
`,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: 'drafted',
                summary: 'No code changes proposed.',
                files_touched: [],
                tests_added: [],
                limitations: [],
                human_questions: [],
                workspace_actions: [],
              }),
            },
          },
        ],
      }));

    await purpose('PROJ-903', { importTicket: true });
    const orchestrator = new AgentOrchestrator();
    await orchestrator.orchestrateUntil('planning');

    const runtimeStore = new RuntimeStore();
    const changeName = (await runtimeStore.getSessionRuntime('PROJ-903'))?.change_name;
    expect(changeName).toBeTruthy();

    await fs.writeFile(
      path.join(tempDir, 'openspec', 'changes', changeName!, 'specs', changeName!, 'spec.md'),
      `${'Large scaffold line\n'.repeat(1200)}`,
      'utf-8'
    );

    const results = await orchestrator.orchestrateUntil('implementation');
    const implementation = results.at(-1);
    expect(implementation?.agent).toBe('implementation_agent');
    expect(implementation?.status).toBe('SUCCEEDED');

    const implementationArtifact = path.join(
      tempDir,
      '.openspec',
      'runtime',
      'tickets',
      'PROJ-903',
      'changes',
      changeName!,
      'implementation',
      'change-report.json'
    );
    const implementationReport = JSON.parse(await fs.readFile(implementationArtifact, 'utf-8'));
    expect(implementationReport).toMatchObject({
      scope_assessment: {
        requires_human_approval: false,
      },
      backend_invocation: {
        status: 'EXECUTED',
      },
    });
    expect(implementationReport.scope_assessment.changed_files_count).toBeLessThanOrEqual(1);
    expect(implementationReport.scope_assessment.diff_lines).toBeLessThan(800);
  });
});
