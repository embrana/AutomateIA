import { randomUUID } from 'crypto';
import {
  ContextAgent,
  type ContextAgentOutput,
} from '../../../agents/context/ContextAgent.js';
import {
  SpecAgent,
  type SpecAgentOutput,
} from '../../../agents/spec/SpecAgent.js';
import {
  PlanningAgent,
  type ExecutionPlan,
  type PlanningAgentOutput,
} from '../../../agents/planning/PlanningAgent.js';
import {
  CriticAgent,
  type CriticAgentInput,
  type CriticAgentOutput,
} from '../../../agents/critic/CriticAgent.js';
import {
  ImplementationAgent,
  type ImplementationAgentInput,
  type ImplementationAgentOutput,
} from '../../../agents/implementation/ImplementationAgent.js';
import {
  ValidationAgent,
  type ValidationAgentInput,
  type ValidationAgentOutput,
} from '../../../agents/validation/ValidationAgent.js';
import {
  DeliveryAgent,
  type DeliveryAgentInput,
  type DeliveryAgentOutput,
} from '../../../agents/delivery/DeliveryAgent.js';
import type {
  Agent,
  AgentContext,
  AgentName,
  AgentResultEnvelope,
  AgentRunEnvelope,
  NextAction,
  NormalizedContext,
} from '../../../agents/base/Agent.js';
import { ArtifactManager } from '../artifacts/ArtifactManager.js';
import { ContextResolver } from '../context/ContextResolver.js';
import { SessionManager } from '../session/SessionManager.js';
import { StateEngine } from '../state/StateEngine.js';
import {
  RUNTIME_LAYOUT_VERSION,
  type AgentRun,
  type AgentRunState,
  type ExecutionCycle,
  type ExecutionCycleState,
  type RuntimeSnapshot,
} from '../types.js';
import { DEFAULT_RUNTIME_POLICY } from './AutonomyPolicy.js';
import { RuntimeStore } from '../../../storage/fs/RuntimeStore.js';
import { ApprovalManager } from '../approvals/ApprovalManager.js';

type SupportedAgent =
  | ContextAgent
  | SpecAgent
  | PlanningAgent
  | ImplementationAgent
  | CriticAgent
  | ValidationAgent
  | DeliveryAgent;

export type OrchestrationStage =
  | 'context'
  | 'spec'
  | 'planning'
  | 'implementation'
  | 'critic'
  | 'validation'
  | 'delivery';

const ORCHESTRATION_PLAN: AgentName[] = [
  'context_agent',
  'spec_agent',
  'planning_agent',
  'implementation_agent',
  'critic_agent',
  'validation_agent',
  'delivery_agent',
];

const EXPECTED_NEXT_ACTION: Partial<Record<AgentName, NextAction>> = {
  context_agent: 'RUN_SPEC_AGENT',
  spec_agent: 'RUN_PLANNING_AGENT',
  planning_agent: 'RUN_IMPLEMENTATION_AGENT',
  implementation_agent: 'RUN_CRITIC_AGENT',
  critic_agent: 'RUN_VALIDATION_AGENT',
  validation_agent: 'RUN_DELIVERY_AGENT',
};

function nowIso(): string {
  return new Date().toISOString();
}

function cycleIdForIteration(iteration: number): string {
  return `cycle-${String(iteration).padStart(3, '0')}`;
}

function isTerminalCycleState(state: ExecutionCycleState): boolean {
  return state === 'FAILED_RETRYABLE'
    || state === 'FAILED_ESCALATED'
    || state === 'PASSED'
    || state === 'CANCELLED';
}

function toAgentRunState(status: AgentResultEnvelope<unknown>['status']): AgentRunState {
  switch (status) {
    case 'ESCALATED':
      return 'ESCALATED';
    case 'REJECTED':
      return 'REJECTED';
    case 'SKIPPED':
      return 'SKIPPED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'SUCCEEDED';
  }
}

function formatBullets(values: string[], fallback: string): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${fallback}`];
}

export interface AgentExecutionSummary {
  agent: AgentName;
  status: AgentResultEnvelope<unknown>['status'];
  recommended_next_action: NextAction;
  artifact_refs: string[];
}

export class AgentOrchestrator {
  private readonly artifactManager: ArtifactManager;
  private readonly sessionManager: SessionManager;
  private readonly contextResolver: ContextResolver;
  private readonly runtimeStore: RuntimeStore;
  private readonly stateEngine: StateEngine;
  private readonly approvalManager: ApprovalManager;
  private readonly agents: Record<AgentName, SupportedAgent>;

  constructor(projectRoot = process.cwd()) {
    this.runtimeStore = new RuntimeStore();
    this.stateEngine = new StateEngine();
    this.artifactManager = new ArtifactManager(this.runtimeStore, projectRoot);
    this.sessionManager = new SessionManager(this.runtimeStore, this.stateEngine);
    this.contextResolver = new ContextResolver(this.sessionManager, this.artifactManager);
    this.approvalManager = new ApprovalManager(this.runtimeStore, this.stateEngine, projectRoot);
    this.agents = {
      context_agent: new ContextAgent(),
      spec_agent: new SpecAgent(),
      planning_agent: new PlanningAgent(),
      implementation_agent: new ImplementationAgent(),
      critic_agent: new CriticAgent(),
      validation_agent: new ValidationAgent(),
      delivery_agent: new DeliveryAgent(),
    };
  }

  async runAgent(agentName: AgentName): Promise<AgentExecutionSummary> {
    const agent = this.agents[agentName];
    const resolved = await this.contextResolver.resolveActive();
    const cycleId = await this.prepareCycleForAgent(agentName, resolved.runtimeSnapshot);
    const envelope = this.buildEnvelope(agentName, resolved.runtimeSnapshot, cycleId);
    const agentContext: AgentContext = {
      projectRoot: this.artifactManager.getProjectRoot(),
      envelope,
      timerSession: resolved.timerSession,
      runtimeSnapshot: resolved.runtimeSnapshot,
      ticket: resolved.ticket,
      projectConfig: resolved.projectConfig,
      existingNormalizedContext: resolved.existingNormalizedContext,
      sessionManager: this.sessionManager,
    };

    const startedAt = nowIso();
    const pendingRun: AgentRun = {
      runtime_version: RUNTIME_LAYOUT_VERSION,
      created_at: startedAt,
      updated_at: startedAt,
      agent_run_id: envelope.run_id,
      agent_name: agentName,
      session_id: envelope.session_id,
      ticket_key: envelope.ticket_key,
      cycle_id: envelope.cycle_id,
      status: 'RUNNING',
      started_at: startedAt,
      input_ref: envelope.input_refs[0],
    };
    await this.artifactManager.writeAgentRun(envelope.ticket_key, envelope.change_name, pendingRun);

    if (!(await agent.canRun(agentContext))) {
      const endedAt = nowIso();
      await this.artifactManager.writeAgentRun(envelope.ticket_key, envelope.change_name, {
        ...pendingRun,
        updated_at: endedAt,
        ended_at: endedAt,
        status: 'REJECTED',
      });
      return {
        agent: agentName,
        status: 'REJECTED',
        recommended_next_action: 'STOP',
        artifact_refs: [],
      };
    }

    const input = await this.resolveAgentInput(agentName, envelope.ticket_key, envelope.change_name);
    const result = await (agent as Agent<typeof input, unknown>).run(input, agentContext);
    const artifactRefs = await this.persistArtifacts(agentName, result, envelope.ticket_key, envelope.change_name, input);
    await this.completeCycleForAgent(agentName, envelope, result);

    const endedAt = nowIso();
    await this.artifactManager.writeAgentRun(envelope.ticket_key, envelope.change_name, {
      ...pendingRun,
      updated_at: endedAt,
      ended_at: endedAt,
      status: toAgentRunState(result.status),
      output_ref: artifactRefs[0],
    });

    return {
      agent: agentName,
      status: result.status,
      recommended_next_action: result.recommended_next_action,
      artifact_refs: artifactRefs,
    };
  }

  async orchestrateUntil(stage: OrchestrationStage): Promise<AgentExecutionSummary[]> {
    const stopIndex = ORCHESTRATION_PLAN.findIndex((item) => item === `${stage}_agent`);
    if (stopIndex < 0) {
      throw new Error(`Unsupported orchestration stage: ${stage}`);
    }

    const startIndex = await this.determineStartIndex();
    if (startIndex > stopIndex) {
      return [];
    }

    const executed: AgentExecutionSummary[] = [];
    for (const agentName of ORCHESTRATION_PLAN.slice(startIndex, stopIndex + 1)) {
      const summary = await this.runAgent(agentName);
      executed.push(summary);

      if (summary.status !== 'SUCCEEDED') {
        break;
      }

      if (agentName !== ORCHESTRATION_PLAN[stopIndex] && !this.shouldContinueAfter(agentName, summary.recommended_next_action)) {
        break;
      }
    }

    return executed;
  }

  private async determineStartIndex(): Promise<number> {
    const resolved = await this.contextResolver.resolveActive();
    const nextAgent = await this.inferNextAgent(resolved.runtimeSnapshot);
    const startIndex = ORCHESTRATION_PLAN.findIndex((agent) => agent === nextAgent);
    return startIndex >= 0 ? startIndex : 0;
  }

  private async inferNextAgent(snapshot: RuntimeSnapshot): Promise<AgentName> {
    const ticketKey = snapshot.ticket.ticket_key;
    const changeName = snapshot.session.change_name;

    if (!changeName) {
      const hasTicketContext = await this.artifactManager.fileExists(this.artifactManager.getTicketContextRef(ticketKey));
      if (!hasTicketContext || snapshot.ticket.state === 'DISCOVERED') {
        return 'context_agent';
      }
      return 'spec_agent';
    }

    const hasPlanning = await this.artifactManager.fileExists(this.artifactManager.getPlanningRef(ticketKey, changeName));
    const hasImplementation = await this.artifactManager.fileExists(this.artifactManager.getImplementationRef(ticketKey, changeName));
    const hasCritic = await this.artifactManager.fileExists(this.artifactManager.getCriticRef(ticketKey, changeName));

    if (snapshot.ticket.state === 'VALIDATION_FAILED' || snapshot.change?.state === 'ARCHIVE_BLOCKED') {
      return 'implementation_agent';
    }

    if (snapshot.change?.state === 'VALIDATED' || snapshot.ticket.state === 'READY_FOR_ARCHIVE') {
      return 'delivery_agent';
    }

    if (snapshot.change?.state === 'UNDER_REVIEW' || snapshot.ticket.state === 'UNDER_REVIEW') {
      return hasCritic ? 'validation_agent' : 'critic_agent';
    }

    if (snapshot.change?.state === 'IN_IMPLEMENTATION' || snapshot.ticket.state === 'IN_EXECUTION') {
      return hasImplementation ? 'critic_agent' : 'implementation_agent';
    }

    if (snapshot.ticket.state === 'PLANNED') {
      return 'implementation_agent';
    }

    if (snapshot.change?.state === 'TASKED' || snapshot.ticket.state === 'SPEC_READY') {
      return hasPlanning ? 'implementation_agent' : 'planning_agent';
    }

    if (snapshot.ticket.state === 'CONTEXT_IMPORTED') {
      return 'spec_agent';
    }

    return 'context_agent';
  }

  private shouldContinueAfter(agentName: AgentName, nextAction: NextAction): boolean {
    const expected = EXPECTED_NEXT_ACTION[agentName];
    if (!expected) {
      return true;
    }
    return nextAction === expected;
  }

  private buildEnvelope(agentName: AgentName, snapshot: RuntimeSnapshot, cycleId: string): AgentRunEnvelope {
    const ticketKey = snapshot.ticket.ticket_key;
    const changeName = snapshot.session.change_name;
    const inputRefs: string[] = [];

    if (agentName !== 'context_agent') {
      if (changeName) {
        inputRefs.push(this.artifactManager.getChangeContextRef(ticketKey, changeName));
      } else {
        inputRefs.push(this.artifactManager.getTicketContextRef(ticketKey));
      }
    }

    if (changeName) {
      inputRefs.push(`openspec/changes/${changeName}/proposal.md`);
      inputRefs.push(`openspec/changes/${changeName}/tasks.md`);
      inputRefs.push(this.artifactManager.getPlanningRef(ticketKey, changeName));
      if (agentName === 'critic_agent' || agentName === 'validation_agent' || agentName === 'delivery_agent') {
        inputRefs.push(this.artifactManager.getImplementationRef(ticketKey, changeName));
      }
      if (agentName === 'validation_agent' || agentName === 'delivery_agent') {
        inputRefs.push(this.artifactManager.getCriticRef(ticketKey, changeName));
      }
      if (agentName === 'delivery_agent') {
        inputRefs.push(this.artifactManager.getValidationRef(ticketKey, changeName));
      }
    }

    return {
      run_id: `run-${randomUUID()}`,
      agent_name: agentName,
      ticket_key: ticketKey,
      session_id: snapshot.session.session_id,
      cycle_id: cycleId,
      autonomy_level: snapshot.session.autonomy_level,
      workspace_root: this.artifactManager.getProjectRoot(),
      change_name: changeName,
      input_refs: inputRefs,
      constraints: {
        canReadJira: true,
        canEditSpecs: agentName === 'context_agent' || agentName === 'spec_agent' || agentName === 'planning_agent',
        canEditCode: agentName === 'implementation_agent',
        canRunValidation: agentName === 'validation_agent',
        canCommentJira: agentName === 'delivery_agent',
        canArchive: agentName === 'delivery_agent',
        maxFilesToEdit: DEFAULT_RUNTIME_POLICY.maxChangedFilesWithoutHumanReview,
        maxDiffLines: DEFAULT_RUNTIME_POLICY.maxDiffLinesWithoutHumanReview,
        highRiskPaths: DEFAULT_RUNTIME_POLICY.highRiskPaths,
      },
      budget: {
        maxMinutes: 10,
        maxRetriesRemaining: Math.max(DEFAULT_RUNTIME_POLICY.maxRetryCycles - snapshot.session.current_cycle, 0),
      },
    };
  }

  private async resolveAgentInput(
    agentName: AgentName,
    ticketKey: string,
    changeName?: string
  ): Promise<unknown> {
    if (agentName === 'context_agent') {
      return undefined;
    }

    const contextRef = changeName
      ? this.artifactManager.getChangeContextRef(ticketKey, changeName)
      : this.artifactManager.getTicketContextRef(ticketKey);
    const normalizedContext = await this.artifactManager.readJsonRef<NormalizedContext>(contextRef);

    if (agentName === 'spec_agent' || agentName === 'planning_agent') {
      return normalizedContext ?? undefined;
    }

    if (!changeName) {
      throw new Error(`Agent ${agentName} requires an active change.`);
    }

    const executionPlan = await this.artifactManager.readJsonRef<ExecutionPlan>(
      this.artifactManager.getPlanningRef(ticketKey, changeName)
    );
    if (!normalizedContext || !executionPlan) {
      throw new Error(`Agent ${agentName} requires both normalized context and execution plan artifacts.`);
    }

    if (agentName === 'implementation_agent') {
      const input: ImplementationAgentInput = {
        normalized_context: normalizedContext,
        execution_plan: executionPlan,
      };
      return input;
    }

    const implementationReport = await this.artifactManager.readJsonRef<ImplementationAgentOutput>(
      this.artifactManager.getImplementationRef(ticketKey, changeName)
    );
    if (!implementationReport) {
      throw new Error(`Agent ${agentName} requires an implementation report artifact.`);
    }

    if (agentName === 'critic_agent') {
      const input: CriticAgentInput = {
        normalized_context: normalizedContext,
        execution_plan: executionPlan,
        implementation_report: implementationReport,
      };
      return input;
    }

    const criticReport = await this.artifactManager.readJsonRef<CriticAgentOutput>(
      this.artifactManager.getCriticRef(ticketKey, changeName)
    );
    if (!criticReport) {
      throw new Error('ValidationAgent requires a critic report artifact.');
    }

    const validationReport = await this.artifactManager.readJsonRef<ValidationAgentOutput>(
      this.artifactManager.getValidationRef(ticketKey, changeName)
    );
    if (agentName === 'validation_agent') {
      const input: ValidationAgentInput = {
        normalized_context: normalizedContext,
        execution_plan: executionPlan,
        implementation_report: implementationReport,
        critic_report: criticReport,
      };
      return input;
    }

    if (!validationReport) {
      throw new Error('DeliveryAgent requires a validation report artifact.');
    }

    const input: DeliveryAgentInput = {
      normalized_context: normalizedContext,
      execution_plan: executionPlan,
      implementation_report: implementationReport,
      critic_report: criticReport,
      validation_report: validationReport,
    };
    return input;
  }

  private async persistArtifacts(
    agentName: AgentName,
    result: AgentResultEnvelope<unknown>,
    ticketKey: string,
    changeName: string | undefined,
    input: unknown
  ): Promise<string[]> {
    switch (agentName) {
      case 'context_agent': {
        const output = result.output as ContextAgentOutput;
        const jsonRef = changeName
          ? await this.artifactManager.writeChangeJson(ticketKey, changeName, 'context', 'normalized-context.json', output.normalized_context)
          : await this.artifactManager.writeTicketJson(ticketKey, 'context', 'normalized-context.json', output.normalized_context);
        const markdown = [
          '# Context Summary',
          '',
          '## Problem Statement',
          output.normalized_context.problem_statement,
          '',
          '## Acceptance Criteria',
          ...formatBullets(output.normalized_context.acceptance_criteria, 'None identified'),
          '',
        ].join('\n');
        const summaryRef = changeName
          ? await this.artifactManager.writeChangeMarkdown(ticketKey, changeName, 'context', 'context-summary.md', markdown)
          : await this.artifactManager.writeTicketMarkdown(ticketKey, 'context', 'context-summary.md', markdown);

        const refreshed = await this.contextResolver.resolveActive();
        await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
          overrideTicketState: refreshed.runtimeSnapshot.ticket.state === 'DISCOVERED'
            ? 'CONTEXT_IMPORTED'
            : undefined,
        });
        return [jsonRef, summaryRef];
      }
      case 'spec_agent': {
        const output = result.output as SpecAgentOutput;
        const summaryLines = [
          '# Spec Diff Summary',
          '',
          `Change: ${output.change_name}`,
          `Scenarios generated: ${output.scenarios_generated}`,
          `Ambiguities remaining: ${output.ambiguities_remaining}`,
          '',
          '## Files',
          ...output.created_files.map((file) => `- ${file}`),
          '',
        ].join('\n');
        const summaryRef = await this.artifactManager.writeChangeMarkdown(ticketKey, output.change_name, 'spec', 'spec-diff-summary.md', summaryLines);

        const refreshed = await this.contextResolver.resolveActive();
        const normalizedContext = (input as NormalizedContext | undefined)
          ?? refreshed.existingNormalizedContext
          ?? await this.artifactManager.readJsonRef<NormalizedContext>(this.artifactManager.getTicketContextRef(ticketKey));
        if (normalizedContext) {
          await this.artifactManager.writeChangeJson(ticketKey, output.change_name, 'context', 'normalized-context.json', normalizedContext);
        }
        await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
          overrideTicketState: refreshed.runtimeSnapshot.ticket.state === 'CONTEXT_IMPORTED'
            || refreshed.runtimeSnapshot.ticket.state === 'DISCOVERED'
            ? 'SPEC_READY'
            : undefined,
        });
        return [summaryRef];
      }
      case 'planning_agent': {
        const output = result.output as PlanningAgentOutput;
        if (!changeName) {
          throw new Error('Planning artifacts require an active change.');
        }
        const jsonRef = await this.artifactManager.writeChangeJson(ticketKey, changeName, 'planning', 'execution-plan.json', output.execution_plan);
        const markdown = [
          '# Execution Plan',
          '',
          `Objective: ${output.execution_plan.objective}`,
          `Estimated risk: ${output.execution_plan.estimated_risk}`,
          '',
          '## Steps',
          ...output.execution_plan.steps.map((step) => `- ${step.id}: ${step.title} (${step.owner})`),
          '',
          '## Files Likely Affected',
          ...output.execution_plan.files_likely_affected.map((file) => `- ${file}`),
          '',
          '## Test Strategy',
          ...output.execution_plan.test_strategy.map((item) => `- ${item}`),
          '',
          `Rollback strategy: ${output.execution_plan.rollback_strategy}`,
          '',
        ].join('\n');
        const mdRef = await this.artifactManager.writeChangeMarkdown(ticketKey, changeName, 'planning', 'execution-plan.md', markdown);

        const refreshed = await this.contextResolver.resolveActive();
        await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
          overrideSessionState: result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL' ? 'AWAITING_HUMAN' : undefined,
          overrideTicketState: result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL'
            ? 'HUMAN_ESCALATION_REQUIRED'
            : 'PLANNED',
        });
        const approvalRefs = await this.persistApprovalIfRequested('planning_agent', result, refreshed.runtimeSnapshot, [jsonRef, mdRef]);
        return [jsonRef, mdRef, ...approvalRefs];
      }
      case 'implementation_agent': {
        const output = result.output as ImplementationAgentOutput;
        if (!changeName) {
          throw new Error('Implementation artifacts require an active change.');
        }
        const jsonRef = await this.artifactManager.writeChangeJson(ticketKey, changeName, 'implementation', 'change-report.json', output);
        const markdown = [
          '# Implementation Report',
          '',
          '## Changes Applied',
          ...formatBullets(output.changes_applied.map((item) => `${item.file}: ${item.summary}`), 'No workspace changes detected'),
          '',
          '## Tasks Completed',
          ...formatBullets(output.tasks_completed, 'None'),
          '',
          '## Tasks Remaining',
          ...formatBullets(output.tasks_remaining, 'None'),
          '',
          '## Tests Added',
          ...formatBullets(output.tests_added, 'None'),
          '',
          '## Policy Assessment',
          `- Changed files: ${output.scope_assessment.changed_files_count}`,
          `- Estimated diff lines: ${output.scope_assessment.diff_lines}`,
          ...formatBullets(output.scope_assessment.policy_reasons, 'Within current autonomy policy budget'),
          '',
          '## Backend Invocation',
          `- Configured: ${output.backend_invocation.configured ? 'yes' : 'no'}`,
          `- Backend: ${output.backend_invocation.backend_name ?? 'none'}`,
          `- Mode: ${output.backend_invocation.mode}`,
          `- Status: ${output.backend_invocation.status}`,
          `- Input tokens: ${
            typeof output.backend_invocation.usage?.input_tokens === 'number'
              ? output.backend_invocation.usage.input_tokens
              : 'N/A'
          }`,
          `- Output tokens: ${
            typeof output.backend_invocation.usage?.output_tokens === 'number'
              ? output.backend_invocation.usage.output_tokens
              : 'N/A'
          }`,
          ...formatBullets(output.backend_invocation.notes, 'No backend notes'),
          '',
          '## Workspace Execution',
          `- Status: ${output.workspace_execution.status}`,
          `- Applied actions: ${output.workspace_execution.applied_actions}`,
          `- Blocked actions: ${output.workspace_execution.blocked_actions}`,
          `- File actions: ${output.workspace_execution.file_actions}`,
          `- Command actions: ${output.workspace_execution.command_actions}`,
          ...formatBullets(output.workspace_execution.touched_files, 'No files touched'),
          ...formatBullets(
            output.workspace_execution.command_results.map((result) =>
              `${result.command.join(' ')} (exit ${result.exit_code})`
            ),
            'No commands executed'
          ),
          '',
          '## Known Limitations',
          ...formatBullets(output.known_limitations, 'None'),
          '',
        ].join('\n');
        const mdRef = await this.artifactManager.writeChangeMarkdown(ticketKey, changeName, 'implementation', 'change-report.md', markdown);
        const backendRefs: string[] = [];
        if (output.backend_invocation.task_prompt) {
          backendRefs.push(
            await this.artifactManager.writeChangeMarkdown(
              ticketKey,
              changeName,
              'implementation',
              'backend-prompt.md',
              [
                '# Implementation Backend Prompt',
                '',
                output.backend_invocation.system_prompt
                  ? `## System Prompt\n${output.backend_invocation.system_prompt}\n`
                  : '',
                '## Task Prompt',
                output.backend_invocation.task_prompt,
                '',
              ].join('\n')
            )
          );
        }
        if (output.backend_invocation.request_payload) {
          backendRefs.push(
            await this.artifactManager.writeChangeJson(
              ticketKey,
              changeName,
              'implementation',
              'backend-request.json',
              output.backend_invocation.request_payload
            )
          );
        }
        if (output.backend_invocation.response_payload !== undefined) {
          backendRefs.push(
            await this.artifactManager.writeChangeJson(
              ticketKey,
              changeName,
              'implementation',
              'backend-response.json',
              output.backend_invocation.response_payload
            )
          );
        }

        const refreshed = await this.contextResolver.resolveActive();
        await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
          overrideSessionState: result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL' ? 'AWAITING_HUMAN' : undefined,
          overrideTicketState: result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL'
            ? 'HUMAN_ESCALATION_REQUIRED'
            : 'IN_EXECUTION',
          overrideChangeState: 'IN_IMPLEMENTATION',
        });
        const approvalRefs = await this.persistApprovalIfRequested(
          'implementation_agent',
          result,
          refreshed.runtimeSnapshot,
          [jsonRef, mdRef, ...backendRefs]
        );
        return [jsonRef, mdRef, ...backendRefs, ...approvalRefs];
      }
      case 'critic_agent': {
        const output = result.output as CriticAgentOutput;
        if (!changeName) {
          throw new Error('Critic artifacts require an active change.');
        }
        const jsonRef = await this.artifactManager.writeChangeJson(ticketKey, changeName, 'review', 'critic-report.json', output);
        const markdown = [
          '# Critic Report',
          '',
          `Review result: ${output.review_result}`,
          '',
          '## Findings',
          ...formatBullets(
            output.findings.map((finding) =>
              `${finding.severity.toUpperCase()}${finding.file ? ` ${finding.file}` : ''}: ${finding.message}`
            ),
            'No findings'
          ),
          '',
        ].join('\n');
        const mdRef = await this.artifactManager.writeChangeMarkdown(ticketKey, changeName, 'review', 'critic-report.md', markdown);

        const refreshed = await this.contextResolver.resolveActive();
        await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
          overrideSessionState: result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL' ? 'AWAITING_HUMAN' : undefined,
          overrideTicketState: result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL'
            ? 'HUMAN_ESCALATION_REQUIRED'
            : 'UNDER_REVIEW',
          overrideChangeState: 'UNDER_REVIEW',
        });
        const approvalRefs = await this.persistApprovalIfRequested('critic_agent', result, refreshed.runtimeSnapshot, [jsonRef, mdRef]);
        return [jsonRef, mdRef, ...approvalRefs];
      }
      case 'validation_agent': {
        const output = result.output as ValidationAgentOutput;
        if (!changeName) {
          throw new Error('Validation artifacts require an active change.');
        }
        const jsonRef = await this.artifactManager.writeChangeJson(ticketKey, changeName, 'validation', 'validation-result.json', output);
        const markdown = [
          '# Validation Result',
          '',
          `Validation result: ${output.validation_result}`,
          `Failure classification: ${output.failure_classification}`,
          `Archive eligible: ${output.archive_eligible ? 'yes' : 'no'}`,
          '',
          '## Checks',
          ...output.checks.map((check) => `- ${check.name}: ${check.status}${check.details ? ` (${check.details})` : ''}`),
          '',
          '## Reasons',
          ...formatBullets(output.reasons, 'None'),
          '',
        ].join('\n');
        const mdRef = await this.artifactManager.writeChangeMarkdown(ticketKey, changeName, 'validation', 'validation-result.md', markdown);

        const refreshed = await this.contextResolver.resolveActive();
        if (output.failure_classification === 'PASSED') {
          await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
            overrideTicketState: 'READY_FOR_ARCHIVE',
            overrideChangeState: 'VALIDATED',
            overrideValidationStatus: 'PASSED',
          });
        } else if (
          output.failure_classification === 'REQUIRES_HUMAN_DECISION'
          || output.failure_classification === 'SPEC_AMBIGUITY'
        ) {
          await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
            overrideSessionState: 'AWAITING_HUMAN',
            overrideTicketState: 'HUMAN_ESCALATION_REQUIRED',
            overrideChangeState: 'UNDER_REVIEW',
            overrideValidationStatus: 'BLOCKED',
          });
        } else if (
          output.failure_classification === 'ENVIRONMENT_FAILURE'
          || output.failure_classification === 'NON_RECOVERABLE'
        ) {
          await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
            overrideSessionState: 'FAILED',
            overrideTicketState: 'BLOCKED',
            overrideChangeState: 'ARCHIVE_BLOCKED',
            overrideValidationStatus: 'BLOCKED',
          });
        } else {
          await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
            overrideTicketState: 'VALIDATION_FAILED',
            overrideChangeState: 'ARCHIVE_BLOCKED',
            overrideValidationStatus: 'FAILED',
          });
        }
        const approvalRefs = await this.persistApprovalIfRequested('validation_agent', result, refreshed.runtimeSnapshot, [jsonRef, mdRef]);
        return [jsonRef, mdRef, ...approvalRefs];
      }
      case 'delivery_agent': {
        const output = result.output as DeliveryAgentOutput;
        if (!changeName) {
          throw new Error('Delivery artifacts require an active change.');
        }
        const closureRef = await this.artifactManager.writeChangeJson(
          ticketKey,
          changeName,
          'delivery',
          'closure-summary.json',
          output.closure_summary
        );
        const archiveDecision = {
          archive_ready: output.archive_ready,
          archive_allowed: output.archive_allowed,
          worklog_allowed: output.worklog_allowed,
          approval_required: output.approval_required,
          approval_id: undefined as string | undefined,
          approval_status: output.approval_required ? 'PENDING' : undefined,
          jira_comment: output.jira_comment,
          blocking_reasons: output.blocking_reasons,
        };
        const decisionRef = await this.artifactManager.writeChangeJson(
          ticketKey,
          changeName,
          'delivery',
          'archive-decision.json',
          archiveDecision
        );
        const approvalRefs = await this.persistApprovalIfRequested(
          'delivery_agent',
          result,
          (await this.contextResolver.resolveActive()).runtimeSnapshot,
          [closureRef, decisionRef]
        );
        const approvalRef = approvalRefs[0];
        const approvalId = approvalRef ? approvalRef.split('/').at(-1)?.replace(/\.json$/, '') : undefined;
        if (approvalId) {
          await this.artifactManager.writeChangeJson(
            ticketKey,
            changeName,
            'delivery',
            'archive-decision.json',
            {
              ...archiveDecision,
              approval_id: approvalId,
            }
          );
        }
        const markdown = [
          '# Delivery Summary',
          '',
          `Archive ready: ${output.archive_ready ? 'yes' : 'no'}`,
          `Archive allowed: ${output.archive_allowed ? 'yes' : 'no'}`,
          `Worklog allowed: ${output.worklog_allowed ? 'yes' : 'no'}`,
          '',
          '## Completed Scope',
          ...formatBullets(output.closure_summary.completed_scope, 'None'),
          '',
          '## Remaining Risks',
          ...formatBullets(output.closure_summary.remaining_risks, 'None'),
          '',
          '## Worklog Preview',
          ...formatBullets(output.closure_summary.worklog_preview, 'None'),
          '',
          '## Jira Comment Draft',
          output.jira_comment,
          '',
        ].join('\n');
        const mdRef = await this.artifactManager.writeChangeMarkdown(ticketKey, changeName, 'delivery', 'closure-summary.md', markdown);

        const refreshed = await this.contextResolver.resolveActive();
        await this.sessionManager.syncFromTimerSession(refreshed.timerSession, {
          overrideSessionState: result.recommended_next_action === 'REQUEST_ARCHIVE_APPROVAL' ? 'AWAITING_HUMAN' : undefined,
          overrideTicketState: result.recommended_next_action === 'REQUEST_ARCHIVE_APPROVAL'
            ? 'HUMAN_ESCALATION_REQUIRED'
            : 'READY_FOR_ARCHIVE',
          overrideChangeState: 'VALIDATED',
          overrideValidationStatus: 'PASSED',
          overrideArchiveEligible: output.archive_allowed,
          overrideWorklogEligible: output.worklog_allowed,
        });
        return [closureRef, decisionRef, mdRef, ...approvalRefs];
      }
      default:
        return result.artifact_refs;
    }
  }

  private async persistApprovalIfRequested(
    agentName: AgentName,
    result: AgentResultEnvelope<unknown>,
    snapshot: RuntimeSnapshot,
    evidenceRefs: string[]
  ): Promise<string[]> {
    if (result.recommended_next_action !== 'REQUEST_HUMAN_APPROVAL' && result.recommended_next_action !== 'REQUEST_ARCHIVE_APPROVAL') {
      return [];
    }

    const approval = await this.approvalManager.ensureApproval({
      ticketKey: snapshot.ticket.ticket_key,
      sessionId: snapshot.session.session_id,
      changeName: snapshot.session.change_name,
      scope: this.inferApprovalScope(agentName, result),
      reason: this.buildApprovalReason(agentName, result),
      evidenceRefs,
    });
    return [this.artifactManager.getApprovalRef(snapshot.ticket.ticket_key, approval.approval_id)];
  }

  private inferApprovalScope(agentName: AgentName, result: AgentResultEnvelope<unknown>): 'plan' | 'implementation' | 'archive' | 'recovery' {
    if (result.recommended_next_action === 'REQUEST_ARCHIVE_APPROVAL' || agentName === 'delivery_agent') {
      return 'archive';
    }
    if (agentName === 'planning_agent') {
      return 'plan';
    }
    if (agentName === 'validation_agent') {
      const output = result.output as ValidationAgentOutput | undefined;
      if (output?.failure_classification === 'ENVIRONMENT_FAILURE' || output?.failure_classification === 'NON_RECOVERABLE') {
        return 'recovery';
      }
    }
    return 'implementation';
  }

  private buildApprovalReason(agentName: AgentName, result: AgentResultEnvelope<unknown>): string {
    switch (agentName) {
      case 'planning_agent':
        return 'Planning agent requires human approval before execution can continue.';
      case 'implementation_agent': {
        const output = result.output as ImplementationAgentOutput;
        return output.scope_assessment.policy_reasons.join('; ')
          || 'Implementation agent exceeded the current autonomous policy budget.';
      }
      case 'critic_agent': {
        const output = result.output as CriticAgentOutput;
        return output.findings.map((finding) => finding.message).join('; ')
          || 'Critic agent requested human review.';
      }
      case 'validation_agent': {
        const output = result.output as ValidationAgentOutput;
        return output.reasons.join('; ')
          || 'Validation requires human intervention before continuing.';
      }
      case 'delivery_agent': {
        const output = result.output as DeliveryAgentOutput;
        return output.blocking_reasons.join('; ')
          || 'Delivery requires explicit archive approval before closeout.';
      }
      default:
        return 'The runtime requested a human checkpoint.';
    }
  }

  private async prepareCycleForAgent(agentName: AgentName, snapshot: RuntimeSnapshot): Promise<string> {
    const changeName = snapshot.session.change_name;
    if (!changeName || (agentName !== 'implementation_agent' && agentName !== 'critic_agent' && agentName !== 'validation_agent')) {
      return 'cycle-000';
    }

    const sessionRuntime = await this.runtimeStore.getSessionRuntime(snapshot.ticket.ticket_key)
      ?? snapshot.session;
    const currentIteration = sessionRuntime.current_cycle;
    const existingCycle = currentIteration > 0
      ? await this.runtimeStore.getExecutionCycle(snapshot.ticket.ticket_key, changeName, cycleIdForIteration(currentIteration))
      : null;

    const shouldCreateNew = !existingCycle || isTerminalCycleState(existingCycle.state);
    const nextIteration = shouldCreateNew ? Math.max(currentIteration, 0) + 1 : currentIteration;
    const cycleId = cycleIdForIteration(nextIteration);
    const desiredState: ExecutionCycleState = agentName === 'implementation_agent'
      ? 'RUNNING'
      : agentName === 'critic_agent'
        ? 'UNDER_REVIEW'
        : 'VALIDATING';
    const updatedAt = nowIso();

    let nextCycle: ExecutionCycle;
    if (shouldCreateNew || !existingCycle || existingCycle.iteration_no !== nextIteration) {
      nextCycle = {
        runtime_version: RUNTIME_LAYOUT_VERSION,
        created_at: updatedAt,
        updated_at: updatedAt,
        cycle_id: cycleId,
        session_id: snapshot.session.session_id,
        ticket_key: snapshot.ticket.ticket_key,
        change_name: changeName,
        iteration_no: nextIteration,
        started_at: updatedAt,
        state: desiredState,
        initiated_by: 'agent',
        trigger_reason: shouldCreateNew && currentIteration > 0 ? 'retry_after_validation' : `${agentName}_started`,
      };
    } else {
      if (existingCycle.state !== desiredState) {
        this.stateEngine.assertCycleTransition(existingCycle.state, desiredState);
      }
      nextCycle = {
        ...existingCycle,
        updated_at: updatedAt,
        state: desiredState,
      };
    }

    await this.runtimeStore.saveExecutionCycle(nextCycle);
    if (sessionRuntime.current_cycle !== nextIteration) {
      await this.runtimeStore.saveSessionRuntime({
        ...sessionRuntime,
        updated_at: updatedAt,
        current_cycle: nextIteration,
      });
    }

    return cycleId;
  }

  private async completeCycleForAgent(
    agentName: AgentName,
    envelope: AgentRunEnvelope,
    result: AgentResultEnvelope<unknown>
  ): Promise<void> {
    if (!envelope.change_name || envelope.cycle_id === 'cycle-000') {
      return;
    }

    const cycle = await this.runtimeStore.getExecutionCycle(envelope.ticket_key, envelope.change_name, envelope.cycle_id);
    if (!cycle) {
      return;
    }

    let nextState = cycle.state;
    let endedAt: string | null | undefined;

    if (agentName === 'implementation_agent') {
      nextState = result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL' ? 'FAILED_ESCALATED' : 'UNDER_REVIEW';
      endedAt = result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL' ? nowIso() : undefined;
    } else if (agentName === 'critic_agent') {
      nextState = result.recommended_next_action === 'REQUEST_HUMAN_APPROVAL'
        ? 'FAILED_ESCALATED'
        : result.recommended_next_action === 'RUN_IMPLEMENTATION_AGENT'
          ? 'FAILED_RETRYABLE'
          : 'UNDER_REVIEW';
      endedAt = nextState === 'UNDER_REVIEW' ? undefined : nowIso();
    } else if (agentName === 'validation_agent') {
      const output = result.output as ValidationAgentOutput;
      nextState = output.failure_classification === 'PASSED'
        ? 'PASSED'
        : output.failure_classification === 'RETRYABLE_IMPLEMENTATION_ERROR'
          ? 'FAILED_RETRYABLE'
          : 'FAILED_ESCALATED';
      endedAt = nowIso();
    }

    if (nextState !== cycle.state) {
      this.stateEngine.assertCycleTransition(cycle.state, nextState);
    }

    await this.runtimeStore.saveExecutionCycle({
      ...cycle,
      updated_at: nowIso(),
      ended_at: endedAt ?? cycle.ended_at,
      state: nextState,
    });
  }
}
