import path from 'path';
import { Validator } from '../../validation/validator.js';
import type { ValidationReport } from '../../validation/types.js';

export interface RuntimeValidationCheck {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  details?: string;
}

export interface RuntimeValidationExecution {
  report: ValidationReport;
  checks: RuntimeValidationCheck[];
}

export class ValidationRunner {
  constructor(private readonly validator = new Validator()) {}

  async runChangeValidation(projectRoot: string, changeName: string): Promise<RuntimeValidationExecution> {
    const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);
    const report = await this.validator.validateChangeDeltaSpecs(changeDir);
    return {
      report,
      checks: [
        {
          name: 'openspec_validate',
          status: report.valid ? 'passed' : 'failed',
          details: report.valid
            ? 'OpenSpec delta validation passed.'
            : `${report.summary.errors} error(s), ${report.summary.warnings} warning(s)`,
        },
      ],
    };
  }
}
