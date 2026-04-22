import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';
import type { ImplementationAgentOutput } from '../implementation/ImplementationAgent.js';
import type { ExecutionPlan } from '../planning/PlanningAgent.js';

export interface CriticFinding {
  severity: 'high' | 'medium' | 'low';
  type: string;
  file?: string;
  message: string;
}

export interface CriticAgentInput {
  normalized_context: NormalizedContext;
  execution_plan: ExecutionPlan;
  implementation_report: ImplementationAgentOutput;
}

export interface CriticAgentOutput {
  review_result: 'APPROVED' | 'CHANGES_REQUESTED';
  findings: CriticFinding[];
}

function buildOverlapSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

export class CriticAgent implements Agent<CriticAgentInput, CriticAgentOutput> {
  readonly name = 'critic_agent' as const;

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.runtimeSnapshot.session.change_name);
  }

  async run(
    input: CriticAgentInput,
    context: AgentContext
  ): Promise<AgentResultEnvelope<CriticAgentOutput>> {
    const findings: CriticFinding[] = [];
    const changedFiles = input.implementation_report.changes_applied.map((item) => item.file);
    const changedFileSet = buildOverlapSet(changedFiles);
    const plannedOverlap = input.execution_plan.files_likely_affected.filter((file) =>
      changedFileSet.has(file.toLowerCase())
    );

    if (input.implementation_report.scope_assessment.requires_human_approval) {
      findings.push({
        severity: 'high',
        type: 'policy_violation',
        message: input.implementation_report.scope_assessment.policy_reasons.join('; '),
      });
    }

    if (input.implementation_report.changes_applied.length === 0) {
      findings.push({
        severity: 'high',
        type: 'missing_implementation',
        message: 'No workspace changes were detected for the active execution cycle.',
      });
    }

    if (input.normalized_context.ambiguities.length > 0) {
      findings.push({
        severity: 'medium',
        type: 'spec_ambiguity',
        message: `Open ambiguities remain: ${input.normalized_context.ambiguities.join('; ')}`,
      });
    }

    if (plannedOverlap.length === 0 && changedFiles.length > 0) {
      findings.push({
        severity: 'low',
        type: 'plan_drift',
        message: 'Observed workspace changes do not overlap with the execution plan impact set.',
      });
    }

    if (input.execution_plan.test_strategy.length > 0 && input.implementation_report.tests_added.length === 0) {
      findings.push({
        severity: 'medium',
        type: 'missing_test_coverage',
        message: 'Implementation report did not include new or updated test files.',
      });
    }

    if (input.implementation_report.tasks_remaining.length > 0) {
      findings.push({
        severity: 'low',
        type: 'tasks_incomplete',
        message: `Plan steps still pending: ${input.implementation_report.tasks_remaining.join(', ')}`,
      });
    }

    const blockingFindings = findings.filter((finding) => finding.severity === 'high' || finding.severity === 'medium');
    const reviewResult = blockingFindings.length > 0 ? 'CHANGES_REQUESTED' : 'APPROVED';

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output: {
        review_result: reviewResult,
        findings,
      },
      artifact_refs: [],
      recommended_next_action: reviewResult === 'APPROVED'
        ? 'RUN_VALIDATION_AGENT'
        : input.implementation_report.scope_assessment.requires_human_approval
          ? 'REQUEST_HUMAN_APPROVAL'
          : 'RUN_IMPLEMENTATION_AGENT',
    };
  }
}
