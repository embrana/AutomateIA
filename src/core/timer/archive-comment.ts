export interface BlockedArchiveCommentInput {
  issueKey: string;
  changeName?: string;
  reason?: string;
  diagnostics: string[];
  worklogId?: string;
}

function includesAny(value: string, patterns: string[]): boolean {
  const lower = value.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

export function summarizeArchiveDiagnostics(diagnostics: string[]): string[] {
  const summary: string[] = [];

  if (diagnostics.some((message) => includesAny(message, ['What Changes section', '## What Changes']))) {
    summary.push('proposal.md is missing required section: ## What Changes');
  }

  if (diagnostics.some((message) => includesAny(message, ['SHALL or MUST']))) {
    summary.push('One or more requirements are missing SHALL or MUST');
  }

  if (diagnostics.some((message) => includesAny(message, ['at least one scenario', 'level-4 scenarios']))) {
    summary.push('One or more requirements are missing level-4 scenarios');
  }

  if (summary.length > 0) {
    return summary;
  }

  const unique = Array.from(new Set(
    diagnostics
      .map((message) => message.replace(/^(ERROR|WARNING|INFO):\s*/i, '').trim())
      .filter(Boolean)
  ));

  return unique.slice(0, 5);
}

export function buildBlockedArchiveComment(input: BlockedArchiveCommentInput): string {
  const validationSummary = summarizeArchiveDiagnostics(input.diagnostics);
  const lines = [
    'OpenSpec archive blocked',
    '',
    `Issue: ${input.issueKey}`,
    input.changeName ? `Change: ${input.changeName}` : undefined,
    'Status: change remains open; specs were not applied',
    input.worklogId
      ? `Worklog: created successfully, id ${input.worklogId}`
      : 'Worklog: developer time will still be logged for this session',
    '',
    'Reason:',
    input.reason || 'OpenSpec archive validation failed. No files were changed.',
    '',
    validationSummary.length > 0 ? 'Validation summary:' : undefined,
    ...validationSummary.map((message) => `- ${message}`),
    '',
    'Next action:',
    'Fix the OpenSpec change spec, then run validation and archive again.',
  ];

  return lines.filter((line): line is string => line !== undefined).join('\n');
}
