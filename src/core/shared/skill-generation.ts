/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import {
  getExploreSkillTemplate,
  getNewChangeSkillTemplate,
  getContinueChangeSkillTemplate,
  getApplyChangeSkillTemplate,
  getFfChangeSkillTemplate,
  getSyncSpecsSkillTemplate,
  getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getVerifyChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxFfCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxVerifyCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxProposeCommandTemplate,
  getOsjApprovalShowSkillTemplate,
  getOsjArchiveRetrySkillTemplate,
  getOsjArchiveSessionSkillTemplate,
  getOsjTicketsSkillTemplate,
  getOsjPurposeStartSkillTemplate,
  getOsjRuntimeExplainSkillTemplate,
  getOsjRuntimeStatusSkillTemplate,
  getOsjTimerReportSkillTemplate,
  getOsjApprovalShowCommandTemplate,
  getOsjArchiveRetryCommandTemplate,
  getOsjArchiveSessionCommandTemplate,
  getOsjTicketsCommandTemplate,
  getOsjPurposeStartCommandTemplate,
  getOsjRuntimeExplainCommandTemplate,
  getOsjRuntimeStatusCommandTemplate,
  getOsjTimerReportCommandTemplate,
  type SkillTemplate,
} from '../templates/skill-templates.js';
import type { CommandContent } from '../command-generation/index.js';

/**
 * Skill template with directory name and workflow ID mapping.
 */
export interface SkillTemplateEntry {
  template: SkillTemplate;
  dirName: string;
  workflowId: string;
}

/**
 * Command template with ID mapping.
 */
export interface CommandTemplateEntry {
  template: ReturnType<typeof getOpsxExploreCommandTemplate>;
  id: string;
}

function getCodexCompanionCommandTemplates(): CommandTemplateEntry[] {
  return [
    { template: getOsjArchiveRetryCommandTemplate(), id: 'osj-archive-retry' },
    { template: getOsjArchiveSessionCommandTemplate(), id: 'osj-archive-session' },
    { template: getOsjTicketsCommandTemplate(), id: 'osj-tickets' },
    { template: getOsjPurposeStartCommandTemplate(), id: 'osj-purpose-start' },
    { template: getOsjRuntimeStatusCommandTemplate(), id: 'osj-runtime-status' },
    { template: getOsjRuntimeExplainCommandTemplate(), id: 'osj-runtime-explain' },
    { template: getOsjApprovalShowCommandTemplate(), id: 'osj-approval-show' },
    { template: getOsjTimerReportCommandTemplate(), id: 'osj-timer-report' },
  ];
}

function getCodexCompanionSkillTemplates(): SkillTemplateEntry[] {
  return [
    { template: getOsjArchiveRetrySkillTemplate(), dirName: 'openspec-osj-archive-retry', workflowId: 'osj-archive-retry' },
    { template: getOsjArchiveSessionSkillTemplate(), dirName: 'openspec-osj-archive-session', workflowId: 'osj-archive-session' },
    { template: getOsjTicketsSkillTemplate(), dirName: 'openspec-osj-tickets', workflowId: 'osj-tickets' },
    { template: getOsjPurposeStartSkillTemplate(), dirName: 'openspec-osj-purpose-start', workflowId: 'osj-purpose-start' },
    { template: getOsjRuntimeStatusSkillTemplate(), dirName: 'openspec-osj-runtime-status', workflowId: 'osj-runtime-status' },
    { template: getOsjRuntimeExplainSkillTemplate(), dirName: 'openspec-osj-runtime-explain', workflowId: 'osj-runtime-explain' },
    { template: getOsjApprovalShowSkillTemplate(), dirName: 'openspec-osj-approval-show', workflowId: 'osj-approval-show' },
    { template: getOsjTimerReportSkillTemplate(), dirName: 'openspec-osj-timer-report', workflowId: 'osj-timer-report' },
  ];
}

/**
 * Gets skill templates with their directory names, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const all: SkillTemplateEntry[] = [
    { template: getExploreSkillTemplate(), dirName: 'openspec-explore', workflowId: 'explore' },
    { template: getNewChangeSkillTemplate(), dirName: 'openspec-new-change', workflowId: 'new' },
    { template: getContinueChangeSkillTemplate(), dirName: 'openspec-continue-change', workflowId: 'continue' },
    { template: getApplyChangeSkillTemplate(), dirName: 'openspec-apply-change', workflowId: 'apply' },
    { template: getFfChangeSkillTemplate(), dirName: 'openspec-ff-change', workflowId: 'ff' },
    { template: getSyncSpecsSkillTemplate(), dirName: 'openspec-sync-specs', workflowId: 'sync' },
    { template: getArchiveChangeSkillTemplate(), dirName: 'openspec-archive-change', workflowId: 'archive' },
    { template: getBulkArchiveChangeSkillTemplate(), dirName: 'openspec-bulk-archive-change', workflowId: 'bulk-archive' },
    { template: getVerifyChangeSkillTemplate(), dirName: 'openspec-verify-change', workflowId: 'verify' },
    { template: getOnboardSkillTemplate(), dirName: 'openspec-onboard', workflowId: 'onboard' },
    { template: getOpsxProposeSkillTemplate(), dirName: 'openspec-propose', workflowId: 'propose' },
  ];

  if (!workflowFilter) return all;

  const filterSet = new Set(workflowFilter);
  return all.filter(entry => filterSet.has(entry.workflowId));
}

/**
 * Returns skill templates for a specific tool.
 * Codex gets the normal workflow skills plus read-only `/osj-*` companion skills.
 */
export function getSkillTemplatesForTool(toolId: string, workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const baseEntries = getSkillTemplates(workflowFilter);
  if (toolId !== 'codex') {
    return baseEntries;
  }

  return [...baseEntries, ...getCodexCompanionSkillTemplates()];
}

/**
 * Gets command templates with their IDs, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose id is in this array
 */
export function getCommandTemplates(workflowFilter?: readonly string[]): CommandTemplateEntry[] {
  const all: CommandTemplateEntry[] = [
    { template: getOpsxExploreCommandTemplate(), id: 'explore' },
    { template: getOpsxNewCommandTemplate(), id: 'new' },
    { template: getOpsxContinueCommandTemplate(), id: 'continue' },
    { template: getOpsxApplyCommandTemplate(), id: 'apply' },
    { template: getOpsxFfCommandTemplate(), id: 'ff' },
    { template: getOpsxSyncCommandTemplate(), id: 'sync' },
    { template: getOpsxArchiveCommandTemplate(), id: 'archive' },
    { template: getOpsxBulkArchiveCommandTemplate(), id: 'bulk-archive' },
    { template: getOpsxVerifyCommandTemplate(), id: 'verify' },
    { template: getOpsxOnboardCommandTemplate(), id: 'onboard' },
    { template: getOpsxProposeCommandTemplate(), id: 'propose' },
  ];

  if (!workflowFilter) return all;

  const filterSet = new Set(workflowFilter);
  return all.filter(entry => filterSet.has(entry.id));
}

/**
 * Converts command templates to CommandContent array, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return contents whose id is in this array
 */
export function getCommandContents(workflowFilter?: readonly string[]): CommandContent[] {
  const commandTemplates = getCommandTemplates(workflowFilter);
  return commandTemplates.map(({ template, id }) => ({
    id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    body: template.content,
  }));
}

/**
 * Returns command contents for a specific tool.
 * Codex gets the normal workflow-backed `/opsx-*` commands plus a small set
 * of read-only `/osj-*` companion commands.
 */
export function getCommandContentsForTool(toolId: string, workflowFilter?: readonly string[]): CommandContent[] {
  const baseContents = getCommandContents(workflowFilter);
  if (toolId !== 'codex') {
    return baseContents;
  }

  const companionContents = getCodexCompanionCommandTemplates().map(({ template, id }) => ({
    id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    body: template.content,
  }));

  return [...baseContents, ...companionContents];
}

/**
 * Returns the managed command ids for a tool.
 */
export function getManagedCommandIdsForTool(toolId: string, workflowFilter?: readonly string[]): string[] {
  return getCommandContentsForTool(toolId, workflowFilter).map((content) => content.id);
}

/**
 * Returns managed skill entries for a tool.
 */
export function getManagedSkillEntriesForTool(toolId: string, workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  return getSkillTemplatesForTool(toolId, workflowFilter);
}

/**
 * Generates skill file content with YAML frontmatter.
 *
 * @param template - The skill template
 * @param generatedByVersion - The OpenSpec version to embed in the file
 * @param transformInstructions - Optional callback to transform the instructions content
 */
export function generateSkillContent(
  template: SkillTemplate,
  generatedByVersion: string,
  transformInstructions?: (instructions: string) => string
): string {
  const instructions = transformInstructions
    ? transformInstructions(template.instructions)
    : template.instructions;

  return `---
name: ${template.name}
description: ${template.description}
license: ${template.license || 'MIT'}
compatibility: ${template.compatibility || 'Requires openspec CLI.'}
metadata:
  author: ${template.metadata?.author || 'openspec'}
  version: "${template.metadata?.version || '1.0'}"
  generatedBy: "${generatedByVersion}"
---

${instructions}
`;
}
