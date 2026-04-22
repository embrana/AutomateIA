import type { AutonomyLevel } from '../types.js';

export interface RuntimePolicyConfig {
  maxRetryCycles: number;
  maxFailedValidations: number;
  maxChangedFilesWithoutHumanReview: number;
  maxDiffLinesWithoutHumanReview: number;
  highRiskPaths: string[];
}

export interface ImplementationScopeAssessment {
  allowed: boolean;
  requiresHumanApproval: boolean;
  changedFilesCount: number;
  diffLines: number;
  highRiskFiles: string[];
  reasons: string[];
}

export const DEFAULT_RUNTIME_POLICY: RuntimePolicyConfig = {
  maxRetryCycles: 3,
  maxFailedValidations: 3,
  maxChangedFilesWithoutHumanReview: 20,
  maxDiffLinesWithoutHumanReview: 800,
  highRiskPaths: ['src/auth/**', 'src/payments/**', 'db/migrations/**'],
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function matchesPolicyPath(file: string, pattern: string): boolean {
  const normalizedFile = normalizePath(file);
  const normalizedPattern = normalizePath(pattern);
  if (normalizedPattern.endsWith('/**')) {
    return normalizedFile.startsWith(normalizedPattern.slice(0, -3));
  }
  return normalizedFile === normalizedPattern;
}

export class AutonomyPolicy {
  constructor(private readonly config: RuntimePolicyConfig = DEFAULT_RUNTIME_POLICY) {}

  evaluateImplementationScope(input: {
    autonomyLevel: AutonomyLevel;
    changedFiles: string[];
    diffLines: number;
  }): ImplementationScopeAssessment {
    const highRiskFiles = input.changedFiles.filter((file) =>
      this.config.highRiskPaths.some((pattern) => matchesPolicyPath(file, pattern))
    );

    const reasons: string[] = [];
    if (highRiskFiles.length > 0) {
      reasons.push(`Changed files touch high-risk paths: ${highRiskFiles.join(', ')}`);
    }
    if (input.changedFiles.length > this.config.maxChangedFilesWithoutHumanReview) {
      reasons.push(
        `Changed file count ${input.changedFiles.length} exceeds limit ${this.config.maxChangedFilesWithoutHumanReview}`
      );
    }
    if (input.diffLines > this.config.maxDiffLinesWithoutHumanReview) {
      reasons.push(
        `Estimated diff size ${input.diffLines} exceeds limit ${this.config.maxDiffLinesWithoutHumanReview}`
      );
    }
    if ((input.autonomyLevel === 'L0_OBSERVE' || input.autonomyLevel === 'L1_DRAFT') && input.changedFiles.length > 0) {
      reasons.push(`Autonomy level ${input.autonomyLevel} does not allow code changes.`);
    }

    return {
      allowed: reasons.length === 0,
      requiresHumanApproval: reasons.length > 0,
      changedFilesCount: input.changedFiles.length,
      diffLines: input.diffLines,
      highRiskFiles,
      reasons,
    };
  }
}
