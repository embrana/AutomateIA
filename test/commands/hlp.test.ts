import { describe, expect, it } from 'vitest';
import { getHlpText } from '../../src/commands/hlp.js';

describe('hlp command text', () => {
  it('shows the full Jira/Tempo workflow by default', () => {
    const text = getHlpText();

    expect(text).toContain('OpenSpec Jira/Tempo Help');
    expect(text).toContain('openspec-jira tickets');
    expect(text).toContain('openspec-jira purpose --pick --import-ticket --create-change');
    expect(text).toContain('openspec-jira timer report');
    expect(text).toContain('openspec-jira archive <change-name> --dry-run');
    expect(text).toContain('openspec-jira archive <change-name> --yes');
  });

  it('shows the short daily workflow', () => {
    const text = getHlpText({ short: true });

    expect(text).toContain('OpenSpec Jira/Tempo Basic Flow');
    expect(text).toContain('1. Configure');
    expect(text).not.toContain('Control time blocks');
  });

  it('shows the sandbox demo workflow', () => {
    const text = getHlpText({ demo: true });

    expect(text).toContain('OpenSpec Jira/Tempo Demo Flow');
    expect(text).toContain('npm run demo:jira');
    expect(text).toContain('mock-jira-worklogs.json');
  });
});
