import { describe, it, expect } from 'vitest';
import {
  getSkillTemplates,
  getSkillTemplatesForTool,
  getCommandTemplates,
  getCommandContents,
  getCommandContentsForTool,
  getManagedSkillEntriesForTool,
  getManagedCommandIdsForTool,
  generateSkillContent,
} from '../../../src/core/shared/skill-generation.js';

describe('skill-generation', () => {
  describe('getSkillTemplates', () => {
    it('should return all 11 skill templates', () => {
      const templates = getSkillTemplates();
      expect(templates).toHaveLength(11);
    });

    it('should have unique directory names', () => {
      const templates = getSkillTemplates();
      const dirNames = templates.map(t => t.dirName);
      const uniqueDirNames = new Set(dirNames);
      expect(uniqueDirNames.size).toBe(templates.length);
    });

    it('should include all expected skills', () => {
      const templates = getSkillTemplates();
      const dirNames = templates.map(t => t.dirName);

      expect(dirNames).toContain('openspec-explore');
      expect(dirNames).toContain('openspec-new-change');
      expect(dirNames).toContain('openspec-continue-change');
      expect(dirNames).toContain('openspec-apply-change');
      expect(dirNames).toContain('openspec-ff-change');
      expect(dirNames).toContain('openspec-sync-specs');
      expect(dirNames).toContain('openspec-archive-change');
      expect(dirNames).toContain('openspec-bulk-archive-change');
      expect(dirNames).toContain('openspec-verify-change');
      expect(dirNames).toContain('openspec-onboard');
      expect(dirNames).toContain('openspec-propose');
    });

    it('should have valid template structure', () => {
      const templates = getSkillTemplates();

      for (const { template, dirName, workflowId } of templates) {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.instructions).toBeTruthy();
        expect(dirName).toBeTruthy();
        expect(workflowId).toBeTruthy();
      }
    });

    it('should have unique workflow IDs', () => {
      const templates = getSkillTemplates();
      const ids = templates.map(t => t.workflowId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(templates.length);
    });

    it('should filter by workflow IDs when provided', () => {
      const filtered = getSkillTemplates(['propose', 'explore', 'apply', 'archive']);
      expect(filtered).toHaveLength(4);
      const ids = filtered.map(t => t.workflowId);
      expect(ids).toContain('propose');
      expect(ids).toContain('explore');
      expect(ids).toContain('apply');
      expect(ids).toContain('archive');
      expect(ids).not.toContain('new');
      expect(ids).not.toContain('ff');
    });

    it('should return all templates when filter is undefined', () => {
      const all = getSkillTemplates();
      const noFilter = getSkillTemplates(undefined);
      expect(noFilter).toHaveLength(all.length);
    });

    it('should return empty array when filter matches nothing', () => {
      const filtered = getSkillTemplates(['nonexistent']);
      expect(filtered).toHaveLength(0);
    });

    it('should return single template when filter has one workflow', () => {
      const filtered = getSkillTemplates(['propose']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].workflowId).toBe('propose');
      expect(filtered[0].dirName).toBe('openspec-propose');
    });

    it('should add Codex-only /osj companion skills for the codex tool', () => {
      const templates = getSkillTemplatesForTool('codex', ['explore']);
      const dirNames = templates.map((entry) => entry.dirName);

      expect(dirNames).toContain('openspec-explore');
      expect(dirNames).toContain('openspec-osj-archive-retry');
      expect(dirNames).toContain('openspec-osj-archive-session');
      expect(dirNames).toContain('openspec-osj-timer-cancel');
      expect(dirNames).toContain('openspec-osj-ticket-show');
      expect(dirNames).toContain('openspec-osj-tickets');
      expect(dirNames).toContain('openspec-osj-purpose-start');
      expect(dirNames).toContain('openspec-osj-runtime-status');
      expect(dirNames).toContain('openspec-osj-runtime-explain');
      expect(dirNames).toContain('openspec-osj-approval-show');
      expect(dirNames).toContain('openspec-osj-timer-report');
    });

    it('should expose managed skill entries for codex', () => {
      expect(getManagedSkillEntriesForTool('codex', ['explore']).map((entry) => entry.dirName)).toEqual([
        'openspec-explore',
        'openspec-osj-archive-retry',
        'openspec-osj-archive-session',
        'openspec-osj-timer-cancel',
        'openspec-osj-ticket-show',
        'openspec-osj-tickets',
        'openspec-osj-purpose-start',
        'openspec-osj-runtime-status',
        'openspec-osj-runtime-explain',
        'openspec-osj-approval-show',
        'openspec-osj-timer-report',
      ]);
    });

    it('should give Codex /osj companion skills a structured non-narrative response contract', () => {
      const runtimeStatusSkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-runtime-status');

      expect(runtimeStatusSkill?.template.instructions).toContain('**Response format**');
      expect(runtimeStatusSkill?.template.instructions).toContain('**Status**');
      expect(runtimeStatusSkill?.template.instructions).toContain('**Conclusion**');
      expect(runtimeStatusSkill?.template.instructions).toContain('**State conflicts**');
      expect(runtimeStatusSkill?.template.instructions).toContain('**Next step**');
      expect(runtimeStatusSkill?.template.instructions).toContain('Do not narrate execution');
      expect(runtimeStatusSkill?.template.instructions).toContain('Do not mention the helper, prompt, or skill implementation details.');
    });

    it('should give Codex /osj-purpose-start skill a list-or-start contract', () => {
      const purposeStartSkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-purpose-start');

      expect(purposeStartSkill?.template.instructions).toContain('If no Jira issue key or `--jira` argument is present:');
      expect(purposeStartSkill?.template.instructions).toContain('run `osj tickets --json`');
      expect(purposeStartSkill?.template.instructions).toContain('build `osj purpose --jira REB-234 --import-ticket`');
      expect(purposeStartSkill?.template.instructions).toContain('**Command**');
      expect(purposeStartSkill?.template.instructions).toContain('Never guess a Jira issue key.');
      expect(purposeStartSkill?.template.instructions).toContain('retry once with escalated permissions');
    });

    it('should tell the Codex /osj-tickets skill to retry Jira fetches with escalated permissions', () => {
      const ticketsSkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-tickets');

      expect(ticketsSkill?.template.instructions).toContain('`fetch failed` style error');
      expect(ticketsSkill?.template.instructions).toContain('retry once with escalated permissions');
    });

    it('should make the Codex /osj-archive-session skill stop when an active change is still attached', () => {
      const archiveSessionSkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-archive-session');

      expect(archiveSessionSkill?.template.instructions).toContain('Inspect the current runtime first with `osj runtime status`');
      expect(archiveSessionSkill?.template.instructions).toContain('If the active session still references a non-archived change, do not run `osj archive`.');
      expect(archiveSessionSkill?.template.instructions).toContain('Never use it to archive an active change.');
      expect(archiveSessionSkill?.template.instructions).toContain('If the first archive attempt leaves the session in `sync_pending`, prefer `osj archive --retry` as the next step.');
    });

    it('should make the Codex /osj-archive-retry skill focus on sync_pending recovery', () => {
      const archiveRetrySkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-archive-retry');

      expect(archiveRetrySkill?.template.instructions).toContain('default: `osj archive --retry`');
      expect(archiveRetrySkill?.template.instructions).toContain('This helper is only for retrying a pending Jira sync.');
      expect(archiveRetrySkill?.template.instructions).toContain('prefer `osj timer cancel` only when the CLI indicates discard is the remaining safe path.');
    });

    it('should make the Codex /osj-timer-cancel skill call out sync_pending discard risk', () => {
      const timerCancelSkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-timer-cancel');

      expect(timerCancelSkill?.template.instructions).toContain('Inspect the current runtime first with `osj runtime status`');
      expect(timerCancelSkill?.template.instructions).toContain('`osj timer cancel`');
      expect(timerCancelSkill?.template.instructions).toContain('cancel discards the pending unsynced Jira worklog instead of retrying it');
      expect(timerCancelSkill?.template.instructions).toContain('cancel does not archive that change');
    });

    it('should make the Codex /osj-ticket-show skill expose imported ticket content from the active session', () => {
      const ticketShowSkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-ticket-show');

      expect(ticketShowSkill?.template.instructions).toContain('default: `osj ticket show --json`');
      expect(ticketShowSkill?.template.instructions).toContain('description text');
      expect(ticketShowSkill?.template.instructions).toContain('no imported Jira ticket context');
    });

    it('should make read-only /osj helpers execute only their own exact command', () => {
      const timerReportSkill = getSkillTemplatesForTool('codex', ['explore'])
        .find((entry) => entry.dirName === 'openspec-osj-timer-report');

      expect(timerReportSkill?.template.instructions).toContain('Run only the exact CLI command defined for this helper.');
      expect(timerReportSkill?.template.instructions).toContain("Do not execute any other `osj` command or any other `/osj-*` helper on the user's behalf.");
      expect(timerReportSkill?.template.instructions).toContain('If another command would help, mention it only in **Next step**.');
    });
  });

  describe('getCommandTemplates', () => {
    it('should return all 11 command templates', () => {
      const templates = getCommandTemplates();
      expect(templates).toHaveLength(11);
    });

    it('should have unique IDs', () => {
      const templates = getCommandTemplates();
      const ids = templates.map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(templates.length);
    });

    it('should include all expected commands', () => {
      const templates = getCommandTemplates();
      const ids = templates.map(t => t.id);

      expect(ids).toContain('explore');
      expect(ids).toContain('new');
      expect(ids).toContain('continue');
      expect(ids).toContain('apply');
      expect(ids).toContain('ff');
      expect(ids).toContain('sync');
      expect(ids).toContain('archive');
      expect(ids).toContain('bulk-archive');
      expect(ids).toContain('verify');
      expect(ids).toContain('onboard');
      expect(ids).toContain('propose');
    });

    it('should filter by workflow IDs when provided', () => {
      const filtered = getCommandTemplates(['propose', 'explore', 'apply', 'archive']);
      expect(filtered).toHaveLength(4);
      const ids = filtered.map(t => t.id);
      expect(ids).toContain('propose');
      expect(ids).toContain('explore');
      expect(ids).toContain('apply');
      expect(ids).toContain('archive');
      expect(ids).not.toContain('new');
      expect(ids).not.toContain('ff');
    });

    it('should return all templates when filter is undefined', () => {
      const all = getCommandTemplates();
      const noFilter = getCommandTemplates(undefined);
      expect(noFilter).toHaveLength(all.length);
    });

    it('should return empty array when filter matches nothing', () => {
      const filtered = getCommandTemplates(['nonexistent']);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('getCommandContents', () => {
    it('should return all 11 command contents', () => {
      const contents = getCommandContents();
      expect(contents).toHaveLength(11);
    });

    it('should have valid content structure', () => {
      const contents = getCommandContents();

      for (const content of contents) {
        expect(content.id).toBeTruthy();
        expect(content.name).toBeTruthy();
        expect(content.description).toBeTruthy();
        expect(content.body).toBeTruthy();
      }
    });

    it('should have matching IDs with command templates', () => {
      const templates = getCommandTemplates();
      const contents = getCommandContents();

      const templateIds = templates.map(t => t.id).sort();
      const contentIds = contents.map(c => c.id).sort();

      expect(contentIds).toEqual(templateIds);
    });

    it('should filter by workflow IDs when provided', () => {
      const filtered = getCommandContents(['propose', 'explore']);
      expect(filtered).toHaveLength(2);
      const ids = filtered.map(c => c.id);
      expect(ids).toContain('propose');
      expect(ids).toContain('explore');
      expect(ids).not.toContain('new');
    });

    it('should return all contents when filter is undefined', () => {
      const all = getCommandContents();
      const noFilter = getCommandContents(undefined);
      expect(noFilter).toHaveLength(all.length);
    });

    it('should add Codex-only /osj companion commands for the codex tool', () => {
      const contents = getCommandContentsForTool('codex', ['explore', 'apply']);
      const ids = contents.map((content) => content.id);

      expect(ids).toContain('explore');
      expect(ids).toContain('apply');
      expect(ids).toContain('osj-archive-retry');
      expect(ids).toContain('osj-archive-session');
      expect(ids).toContain('osj-timer-cancel');
      expect(ids).toContain('osj-ticket-show');
      expect(ids).toContain('osj-tickets');
      expect(ids).toContain('osj-purpose-start');
      expect(ids).toContain('osj-runtime-status');
      expect(ids).toContain('osj-runtime-explain');
      expect(ids).toContain('osj-approval-show');
      expect(ids).toContain('osj-timer-report');
    });

    it('should not add /osj companion commands for non-codex tools', () => {
      const contents = getCommandContentsForTool('claude', ['explore', 'apply']);
      const ids = contents.map((content) => content.id);

      expect(ids).toContain('explore');
      expect(ids).toContain('apply');
      expect(ids.some((id) => id.startsWith('osj-'))).toBe(false);
    });

    it('should expose managed command ids for codex', () => {
      expect(getManagedCommandIdsForTool('codex', ['explore'])).toEqual([
        'explore',
        'osj-archive-retry',
        'osj-archive-session',
        'osj-timer-cancel',
        'osj-ticket-show',
        'osj-tickets',
        'osj-purpose-start',
        'osj-runtime-status',
        'osj-runtime-explain',
        'osj-approval-show',
        'osj-timer-report',
      ]);
    });

    it('should keep Codex /osj prompts minimal and skill-backed', () => {
      const runtimeStatus = getCommandContentsForTool('codex', ['explore'])
        .find((content) => content.id === 'osj-runtime-status');

      expect(runtimeStatus?.body).toContain('openspec-osj-runtime-status');
      expect(runtimeStatus?.body).not.toContain('**Steps**');
      expect(runtimeStatus?.body).not.toContain('**Guardrails**');
    });

    it('should keep the Codex /osj-purpose-start prompt minimal and skill-backed', () => {
      const purposeStart = getCommandContentsForTool('codex', ['explore'])
        .find((content) => content.id === 'osj-purpose-start');

      expect(purposeStart?.body).toContain('openspec-osj-purpose-start');
      expect(purposeStart?.body).toContain('osj tickets --json');
      expect(purposeStart?.body).not.toContain('**Steps**');
      expect(purposeStart?.body).not.toContain('**Guardrails**');
    });

    it('should keep the Codex /osj-archive-session prompt minimal and skill-backed', () => {
      const archiveSession = getCommandContentsForTool('codex', ['explore'])
        .find((content) => content.id === 'osj-archive-session');

      expect(archiveSession?.body).toContain('openspec-osj-archive-session');
      expect(archiveSession?.body).toContain('osj archive --comment "Implementation session"');
      expect(archiveSession?.body).not.toContain('**Steps**');
      expect(archiveSession?.body).not.toContain('**Guardrails**');
    });

    it('should keep the Codex /osj-archive-retry prompt minimal and skill-backed', () => {
      const archiveRetry = getCommandContentsForTool('codex', ['explore'])
        .find((content) => content.id === 'osj-archive-retry');

      expect(archiveRetry?.body).toContain('openspec-osj-archive-retry');
      expect(archiveRetry?.body).toContain('osj archive --retry');
      expect(archiveRetry?.body).not.toContain('**Steps**');
      expect(archiveRetry?.body).not.toContain('**Guardrails**');
    });

    it('should keep the Codex /osj-timer-cancel prompt minimal and skill-backed', () => {
      const timerCancel = getCommandContentsForTool('codex', ['explore'])
        .find((content) => content.id === 'osj-timer-cancel');

      expect(timerCancel?.body).toContain('openspec-osj-timer-cancel');
      expect(timerCancel?.body).toContain('osj timer cancel');
      expect(timerCancel?.body).not.toContain('**Steps**');
      expect(timerCancel?.body).not.toContain('**Guardrails**');
    });

    it('should keep the Codex /osj-ticket-show prompt minimal and skill-backed', () => {
      const ticketShow = getCommandContentsForTool('codex', ['explore'])
        .find((content) => content.id === 'osj-ticket-show');

      expect(ticketShow?.body).toContain('openspec-osj-ticket-show');
      expect(ticketShow?.body).toContain('osj ticket show --json');
      expect(ticketShow?.body).not.toContain('**Steps**');
      expect(ticketShow?.body).not.toContain('**Guardrails**');
    });
  });

  describe('generateSkillContent', () => {
    it('should generate valid YAML frontmatter', () => {
      const template = {
        name: 'test-skill',
        description: 'Test description',
        instructions: 'Test instructions',
        license: 'MIT',
        compatibility: 'Test compatibility',
        metadata: {
          author: 'test-author',
          version: '2.0',
        },
      };

      const content = generateSkillContent(template, '0.23.0');

      expect(content).toMatch(/^---\n/);
      expect(content).toContain('name: test-skill');
      expect(content).toContain('description: Test description');
      expect(content).toContain('license: MIT');
      expect(content).toContain('compatibility: Test compatibility');
      expect(content).toContain('author: test-author');
      expect(content).toContain('version: "2.0"');
      expect(content).toContain('generatedBy: "0.23.0"');
      expect(content).toContain('Test instructions');
    });

    it('should use default values for optional fields', () => {
      const template = {
        name: 'minimal-skill',
        description: 'Minimal description',
        instructions: 'Minimal instructions',
      };

      const content = generateSkillContent(template, '0.24.0');

      expect(content).toContain('license: MIT');
      expect(content).toContain('compatibility: Requires openspec CLI.');
      expect(content).toContain('author: openspec');
      expect(content).toContain('version: "1.0"');
      expect(content).toContain('generatedBy: "0.24.0"');
    });

    it('should embed the provided version in generatedBy field', () => {
      const template = {
        name: 'version-test',
        description: 'Test version embedding',
        instructions: 'Instructions',
      };

      const content1 = generateSkillContent(template, '0.23.0');
      expect(content1).toContain('generatedBy: "0.23.0"');

      const content2 = generateSkillContent(template, '1.0.0');
      expect(content2).toContain('generatedBy: "1.0.0"');

      const content3 = generateSkillContent(template, '0.24.0-beta.1');
      expect(content3).toContain('generatedBy: "0.24.0-beta.1"');
    });

    it('should end frontmatter with separator and blank line', () => {
      const template = {
        name: 'test',
        description: 'Test',
        instructions: 'Body content',
      };

      const content = generateSkillContent(template, '0.23.0');

      expect(content).toMatch(/---\n\nBody content\n$/);
    });

    it('should apply transformInstructions callback when provided', () => {
      const template = {
        name: 'transform-test',
        description: 'Test transform callback',
        instructions: 'Use /opsx:new to start and /opsx:apply to implement.',
      };

      const transformer = (text: string) => text.replace(/\/opsx:/g, '/opsx-');
      const content = generateSkillContent(template, '0.23.0', transformer);

      expect(content).toContain('/opsx-new');
      expect(content).toContain('/opsx-apply');
      expect(content).not.toContain('/opsx:new');
      expect(content).not.toContain('/opsx:apply');
    });

    it('should not transform instructions when callback is undefined', () => {
      const template = {
        name: 'no-transform-test',
        description: 'Test without transform',
        instructions: 'Use /opsx:new to start.',
      };

      const content = generateSkillContent(template, '0.23.0', undefined);

      expect(content).toContain('/opsx:new');
    });

    it('should support custom transformInstructions logic', () => {
      const template = {
        name: 'custom-transform',
        description: 'Test custom transform',
        instructions: 'Some PLACEHOLDER text here.',
      };

      const customTransformer = (text: string) => text.replace('PLACEHOLDER', 'REPLACED');
      const content = generateSkillContent(template, '0.23.0', customTransformer);

      expect(content).toContain('Some REPLACED text here.');
      expect(content).not.toContain('PLACEHOLDER');
    });
  });
});
