import type { RuntimeValidationCheck } from './ValidationRunner.js';

export type ValidationFailureClassification =
  | 'PASSED'
  | 'RETRYABLE_IMPLEMENTATION_ERROR'
  | 'SPEC_AMBIGUITY'
  | 'ENVIRONMENT_FAILURE'
  | 'REQUIRES_HUMAN_DECISION'
  | 'NON_RECOVERABLE';

export interface ValidationClassificationResult {
  classification: ValidationFailureClassification;
  archiveEligible: boolean;
  reasons: string[];
}

export class ValidationClassifier {
  classify(input: {
    checks: RuntimeValidationCheck[];
    hasCriticBlockingFindings: boolean;
    hasScopeEscalation: boolean;
    hasSpecAmbiguity: boolean;
    tasksComplete: boolean;
    environmentFailure?: string;
  }): ValidationClassificationResult {
    const failedChecks = input.checks.filter((check) => check.status === 'failed');
    const reasons = failedChecks.map((check) => check.details ?? `${check.name} failed`);

    if (input.environmentFailure) {
      return {
        classification: 'ENVIRONMENT_FAILURE',
        archiveEligible: false,
        reasons: [input.environmentFailure],
      };
    }

    if (input.hasScopeEscalation) {
      return {
        classification: 'REQUIRES_HUMAN_DECISION',
        archiveEligible: false,
        reasons: [...reasons, 'Implementation scope exceeded the autonomous policy budget.'],
      };
    }

    if (input.hasSpecAmbiguity && failedChecks.length > 0) {
      return {
        classification: 'SPEC_AMBIGUITY',
        archiveEligible: false,
        reasons: [...reasons, 'Ticket or spec ambiguities remain unresolved.'],
      };
    }

    if (failedChecks.length === 0 && !input.hasCriticBlockingFindings && input.tasksComplete) {
      return {
        classification: 'PASSED',
        archiveEligible: true,
        reasons: ['All validation checks passed for the current cycle.'],
      };
    }

    if (input.hasCriticBlockingFindings || failedChecks.length > 0 || !input.tasksComplete) {
      const taskReason = input.tasksComplete ? [] : ['tasks.md still contains incomplete items.'];
      return {
        classification: 'RETRYABLE_IMPLEMENTATION_ERROR',
        archiveEligible: false,
        reasons: [...reasons, ...taskReason],
      };
    }

    return {
      classification: 'NON_RECOVERABLE',
      archiveEligible: false,
      reasons: ['Validation could not classify the current runtime state.'],
    };
  }
}
