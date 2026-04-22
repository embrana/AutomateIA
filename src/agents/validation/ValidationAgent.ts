import path from 'path';
import { getTaskProgressForChange } from '../../utils/task-progress.js';
import { ValidationClassifier } from '../../core/runtime/validation/ValidationClassifier.js';
import type { ValidationFailureClassification } from '../../core/runtime/validation/ValidationClassifier.js';
import { ValidationRunner } from '../../core/runtime/validation/ValidationRunner.js';
import type { RuntimeValidationCheck } from '../../core/runtime/validation/ValidationRunner.js';
import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';
import type { CriticAgentOutput } from '../critic/CriticAgent.js';
import type { ImplementationAgentOutput } from '../implementation/ImplementationAgent.js';
import type { ExecutionPlan } from '../planning/PlanningAgent.js';

export interface ValidationAgentInput {
  normalized_context: NormalizedContext;
  execution_plan: ExecutionPlan;
  implementation_report: ImplementationAgentOutput;
  critic_report: CriticAgentOutput;
}

export interface ValidationAgentOutput {
  validation_result: 'PASSED' | 'FAILED';
  checks: RuntimeValidationCheck[];
  failure_classification: ValidationFailureClassification;
  archive_eligible: boolean;
  reasons: string[];
}

export class ValidationAgent implements Agent<ValidationAgentInput, ValidationAgentOutput> {
  readonly name = 'validation_agent' as const;

  constructor(
    private readonly validationRunner = new ValidationRunner(),
    private readonly validationClassifier = new ValidationClassifier()
  ) {}

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.runtimeSnapshot.session.change_name);
  }

  async run(
    input: ValidationAgentInput,
    context: AgentContext
  ): Promise<AgentResultEnvelope<ValidationAgentOutput>> {
    const changeName = context.runtimeSnapshot.session.change_name;
    if (!changeName) {
      throw new Error('ValidationAgent requires an active change.');
    }

    let environmentFailure: string | undefined;
    let validationChecks: RuntimeValidationCheck[] = [];
    try {
      const validationExecution = await this.validationRunner.runChangeValidation(context.projectRoot, changeName);
      validationChecks = validationExecution.checks;
    } catch (error) {
      environmentFailure = error instanceof Error ? error.message : 'Unknown validation runner failure';
    }

    const taskProgress = await getTaskProgressForChange(path.join(context.projectRoot, 'openspec', 'changes'), changeName);
    const tasksComplete = taskProgress.total > 0 && taskProgress.completed === taskProgress.total;
    const criticBlockingFindings = input.critic_report.findings.filter((finding) => finding.severity === 'high' || finding.severity === 'medium');

    const checks: RuntimeValidationCheck[] = [
      ...validationChecks,
      {
        name: 'critic_review',
        status: criticBlockingFindings.length === 0 ? 'passed' : 'failed',
        details: criticBlockingFindings.length === 0
          ? 'Critic review approved the current implementation.'
          : `${criticBlockingFindings.length} blocking critic finding(s) remain.`,
      },
      {
        name: 'tasks_complete',
        status: tasksComplete ? 'passed' : 'failed',
        details: tasksComplete
          ? 'tasks.md is fully complete for the active change.'
          : `${taskProgress.completed}/${taskProgress.total} task(s) complete in tasks.md.`,
      },
    ];

    const classification = this.validationClassifier.classify({
      checks,
      hasCriticBlockingFindings: criticBlockingFindings.length > 0,
      hasScopeEscalation: input.implementation_report.scope_assessment.requires_human_approval,
      hasSpecAmbiguity: input.normalized_context.ambiguities.length > 0,
      tasksComplete,
      environmentFailure,
    });

    const output: ValidationAgentOutput = {
      validation_result: classification.classification === 'PASSED' ? 'PASSED' : 'FAILED',
      checks,
      failure_classification: classification.classification,
      archive_eligible: classification.archiveEligible,
      reasons: classification.reasons,
    };

    const recommendedNextAction = classification.classification === 'PASSED'
      ? 'RUN_DELIVERY_AGENT'
      : classification.classification === 'REQUIRES_HUMAN_DECISION' || classification.classification === 'SPEC_AMBIGUITY'
        ? 'REQUEST_HUMAN_APPROVAL'
        : classification.classification === 'ENVIRONMENT_FAILURE' || classification.classification === 'NON_RECOVERABLE'
          ? 'OPEN_RECOVERY_FLOW'
          : 'RUN_IMPLEMENTATION_AGENT';

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output,
      artifact_refs: [],
      recommended_next_action: recommendedNextAction,
    };
  }
}
