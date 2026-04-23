import { promises as fs } from 'fs';
import path from 'path';
import { createChange } from '../../utils/change-utils.js';
import { getTimerConfig } from './config.js';
import { JiraClient, resolveJiraConfig } from './jira-client.js';
import { normalizeJiraTicket } from './jira-ticket.js';
import type { ImportedJiraTicket } from './types.js';

export interface TicketChangeResult {
  name: string;
  path: string;
  schema: string;
  ticket: ImportedJiraTicket;
}

export interface CreateChangeFromTicketOptions {
  name?: string;
  schema?: string;
}

export interface AcceptanceCriterion {
  id: string;
  title: string;
  body: string;
}

export interface StructuredSdd {
  title: string;
  context: string;
  goals: string;
  nonGoals: string;
  acceptanceCriteria: AcceptanceCriterion[];
  businessRules: string;
  domainContracts: string;
  uxErrorStates: string;
  outOfScope: string;
  traceability: string;
}

const TICKET_FIELDS = ['summary', 'description', 'status', 'assignee'];

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'jira-ticket';
}

export function deriveChangeNameFromTicket(ticket: ImportedJiraTicket): string {
  const keySlug = slugify(ticket.key);
  const summarySlug = slugify(ticket.summary).split('-').slice(0, 7).join('-');
  const combined = summarySlug ? `${keySlug}-${summarySlug}` : keySlug;
  return combined.slice(0, 80).replace(/-+$/g, '');
}

export async function fetchImportedJiraTicket(issueKey: string): Promise<ImportedJiraTicket> {
  const config = getTimerConfig();
  const jiraConfig = resolveJiraConfig(config.jira);
  const jira = new JiraClient(jiraConfig);
  const issue = await jira.getIssue(issueKey, { fields: TICKET_FIELDS });
  return normalizeJiraTicket(
    issue,
    jira.getIssueUrl(typeof issue.key === 'string' ? issue.key : issueKey)
  );
}

function formatOptional(value: string | null): string {
  return value && value.trim() ? value : 'Unassigned';
}

function quoteTextBlock(text: string): string {
  if (!text.trim()) {
    return '> No Jira description provided.';
  }
  return text
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
}

function cleanMarkdownBlock(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SECTION_ALIASES = {
  context: ['Context', 'Contexto'],
  goals: ['Goals', 'Objetivos', 'Objetivo'],
  nonGoals: ['Non-Goals', 'Non Goals', 'No objetivos', 'No objetivos principales'],
  acceptanceCriteria: ['Acceptance Criteria', 'Criterios de aceptacion', 'Criterios de aceptación'],
  businessRules: ['Business Rules', 'Reglas de negocio'],
  domainContracts: [
    'Domain / Data / Integration Contracts',
    'Domain Data Integration Contracts',
    'Contratos de dominio datos integraciones',
    'Contratos de dominio / datos / integraciones',
    'Contratos de dominio/datos/integraciones',
  ],
  uxErrorStates: [
    'UX / Error States',
    'UX Error States',
    'Estados UX / Error',
    'Estados UX/Error',
    'Estados de UX / Error',
    'Estados de UX/Error',
  ],
  outOfScope: ['Out of Scope', 'Fuera de alcance'],
  traceability: ['Traceability', 'Trazabilidad'],
} as const;

function normalizeHeading(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLevelTwoSections(description: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = Array.from(description.matchAll(/^##\s+(.+?)\s*$/gm));

  matches.forEach((match, index) => {
    const next = matches[index + 1];
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = next?.index ?? description.length;
    const heading = cleanMarkdownBlock(match[1]);
    const body = cleanMarkdownBlock(description.slice(bodyStart, bodyEnd));
    const normalized = normalizeHeading(heading);

    if (!sections.has(normalized)) {
      sections.set(normalized, body);
    }
  });

  return sections;
}

function getSection(sections: Map<string, string>, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const section = sections.get(normalizeHeading(alias));
    if (section) {
      return section;
    }
  }
  return '';
}

function extractSpecTitle(description: string, fallback: string): string {
  const match = description.match(/^#\s*(?:SPEC|ESPEC)\s*:\s*(.+)$/im);
  return cleanMarkdownBlock(match?.[1] ?? fallback);
}

function parseAcceptanceCriteria(section: string): AcceptanceCriterion[] {
  const matches = Array.from(section.matchAll(/^###\s+(CA-\d+)\s*(?:[—–-]|:)\s*(.+?)\s*$/gim));
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = next?.index ?? section.length;
    return {
      id: match[1].toUpperCase(),
      title: cleanMarkdownBlock(match[2]),
      body: cleanMarkdownBlock(section.slice(bodyStart, bodyEnd)),
    };
  });
}

export function parseStructuredSdd(description: string, fallbackTitle: string): StructuredSdd | null {
  const sections = getLevelTwoSections(description);
  const acceptanceSection = getSection(sections, SECTION_ALIASES.acceptanceCriteria);
  const acceptanceCriteria = parseAcceptanceCriteria(acceptanceSection);
  const businessRules = getSection(sections, SECTION_ALIASES.businessRules);

  if (acceptanceCriteria.length === 0 && !businessRules) {
    return null;
  }

  return {
    title: extractSpecTitle(description, fallbackTitle),
    context: getSection(sections, SECTION_ALIASES.context),
    goals: getSection(sections, SECTION_ALIASES.goals),
    nonGoals: getSection(sections, SECTION_ALIASES.nonGoals),
    acceptanceCriteria,
    businessRules,
    domainContracts: getSection(sections, SECTION_ALIASES.domainContracts),
    uxErrorStates: getSection(sections, SECTION_ALIASES.uxErrorStates),
    outOfScope: getSection(sections, SECTION_ALIASES.outOfScope),
    traceability: getSection(sections, SECTION_ALIASES.traceability),
  };
}

function formatImportedSection(title: string, body: string): string {
  if (!body) {
    return '';
  }
  return `\nImported ${title}:\n\n${body}\n`;
}

function formatScenarioBody(body: string): string {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '- **THEN** the system SHALL satisfy this acceptance criterion';
  }

  return lines
    .map((line) => {
      if (line.startsWith('- ')) {
        return line;
      }
      if (/^\*\*(GIVEN|AND|WHEN|THEN)\*\*/i.test(line)) {
        return `- ${line}`;
      }
      return `- ${line}`;
    })
    .join('\n');
}

function buildProposal(ticket: ImportedJiraTicket, changeName: string): string {
  return `## Why

Imported from Jira issue [${ticket.key}](${ticket.url}).

${ticket.description_text || 'No Jira description provided.'}

## What Changes

${ticket.summary || `Implement ${ticket.key}`}.

## Capabilities

### New Capabilities
- \`${changeName}\`: ${ticket.summary || `Work requested by ${ticket.key}`}

### Modified Capabilities
- None identified from the Jira import. Update this section if the ticket changes an existing capability.

## Impact

- Jira: [${ticket.key}](${ticket.url})
- Status: ${ticket.status || 'Unknown'}
- Assignee: ${formatOptional(ticket.assignee)}
`;
}

function descriptionLooksLikeDeltaSpec(description: string): boolean {
  return /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/m.test(description);
}

function buildDeltaSpec(ticket: ImportedJiraTicket): string {
  if (descriptionLooksLikeDeltaSpec(ticket.description_text)) {
    return `${ticket.description_text.trim()}\n`;
  }

  const structured = parseStructuredSdd(ticket.description_text, ticket.summary || `Implement ${ticket.key}`);
  if (structured) {
    const scenarios = structured.acceptanceCriteria.length > 0
      ? structured.acceptanceCriteria
        .map((criterion) => `#### Scenario: ${criterion.id} - ${criterion.title}
${formatScenarioBody(criterion.body)}`)
        .join('\n\n')
      : `#### Scenario: Jira SDD request is satisfied
- **GIVEN** Jira issue \`${ticket.key}\` provides structured SDD context
- **WHEN** the change is implemented
- **THEN** the implementation SHALL satisfy the imported SDD context`;

    return `## ADDED Requirements

### Requirement: ${structured.title}
The system SHALL implement the behavior specified by Jira issue \`${ticket.key}\`.
${formatImportedSection('context', structured.context)}
${formatImportedSection('goals', structured.goals)}
${formatImportedSection('business rules', structured.businessRules)}
${formatImportedSection('domain/data/integration contracts', structured.domainContracts)}
${formatImportedSection('UX/error states', structured.uxErrorStates)}
${formatImportedSection('non-goals', structured.nonGoals)}
${formatImportedSection('out of scope', structured.outOfScope)}
${formatImportedSection('traceability', structured.traceability)}
${scenarios}
`;
  }

  const requirementTitle = ticket.summary || `Implement ${ticket.key}`;
  return `## ADDED Requirements

### Requirement: ${requirementTitle}
The system SHALL implement the behavior requested by Jira issue \`${ticket.key}\`.

Imported Jira description:

${quoteTextBlock(ticket.description_text)}

#### Scenario: Jira ticket request is satisfied
- **GIVEN** Jira issue \`${ticket.key}\` describes requested behavior
- **WHEN** the change is implemented
- **THEN** the implementation SHALL satisfy the imported Jira ticket description
`;
}

function buildTasks(ticket: ImportedJiraTicket): string {
  const structured = parseStructuredSdd(ticket.description_text, ticket.summary || `Implement ${ticket.key}`);
  const acceptanceTasks = structured?.acceptanceCriteria.length
    ? `\n## 2. Acceptance Criteria Coverage\n\n${structured.acceptanceCriteria
        .map((criterion, index) => `- [ ] 2.${index + 1} Implement and verify ${criterion.id}: ${criterion.title}`)
        .join('\n')}\n`
    : '';

  return `## 1. Jira Ticket Review

- [ ] 1.1 Review imported Jira ticket context for \`${ticket.key}\`
- [ ] 1.2 Confirm affected capabilities and acceptance criteria
- [ ] 1.3 Implement the requested change
- [ ] 1.4 Validate the change and archive it
${acceptanceTasks}
`;
}

function buildTicketMarkdown(ticket: ImportedJiraTicket): string {
  return `# ${ticket.key} - ${ticket.summary || 'Imported Jira Ticket'}

- URL: ${ticket.url}
- Status: ${ticket.status || 'Unknown'}
- Assignee: ${formatOptional(ticket.assignee)}

## Description

${ticket.description_text || 'No Jira description provided.'}
`;
}

export async function createChangeFromTicket(
  ticket: ImportedJiraTicket,
  options: CreateChangeFromTicketOptions = {}
): Promise<TicketChangeResult> {
  const projectRoot = process.cwd();
  const changeName = options.name || deriveChangeNameFromTicket(ticket);
  const result = await createChange(projectRoot, changeName, { schema: options.schema });
  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);
  const specDir = path.join(changeDir, 'specs', changeName);

  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), buildProposal(ticket, changeName), 'utf-8');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), buildTasks(ticket), 'utf-8');
  await fs.writeFile(path.join(changeDir, 'jira-ticket.md'), buildTicketMarkdown(ticket), 'utf-8');
  await fs.writeFile(path.join(specDir, 'spec.md'), buildDeltaSpec(ticket), 'utf-8');

  return {
    name: changeName,
    path: changeDir,
    schema: result.schema,
    ticket,
  };
}

export async function createChangeFromJiraIssue(
  issueKey: string,
  options: CreateChangeFromTicketOptions = {}
): Promise<TicketChangeResult> {
  const ticket = await fetchImportedJiraTicket(issueKey);
  return createChangeFromTicket(ticket, options);
}
