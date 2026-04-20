import { describe, expect, it } from 'vitest';
import {
  buildBlockedArchiveComment,
  summarizeArchiveDiagnostics,
} from '../../src/core/timer/archive-comment.js';

describe('OpenSpec archive Jira comments', () => {
  it('deduplicates repeated archive diagnostics into an actionable summary', () => {
    const summary = summarizeArchiveDiagnostics([
      'Proposal warnings in proposal.md (non-blocking):',
      'ERROR: Change must have a What Changes section. Missing required sections.',
      'ERROR: Requirement must have at least one scenario',
      'ERROR: Requirement must contain SHALL or MUST keyword',
      'ERROR: Requirement must have at least one scenario',
      'WARNING: Requirement must have at least one scenario. Scenarios must use level-4 headers.',
    ]);

    expect(summary).toEqual([
      'proposal.md is missing required section: ## What Changes',
      'One or more requirements are missing SHALL or MUST',
      'One or more requirements are missing level-4 scenarios',
    ]);
  });

  it('builds a compact blocked archive comment with the created worklog id', () => {
    const comment = buildBlockedArchiveComment({
      issueKey: 'PROJ-123',
      changeName: 'proj-123-demo-change',
      reason: 'Validation errors in rebuilt spec. No files were changed.',
      worklogId: 'demo-worklog-1',
      diagnostics: [
        'ERROR: Requirement must have at least one scenario',
        'ERROR: Requirement must contain SHALL or MUST keyword',
        'ERROR: Requirement must have at least one scenario',
      ],
    });

    expect(comment).toContain('OpenSpec archive blocked');
    expect(comment).toContain('Issue: PROJ-123');
    expect(comment).toContain('Status: change remains open; specs were not applied');
    expect(comment).toContain('Worklog: created successfully, id demo-worklog-1');
    expect(comment.match(/Requirement must have at least one scenario/g)).toBeNull();
    expect(comment).toContain('One or more requirements are missing level-4 scenarios');
  });
});
