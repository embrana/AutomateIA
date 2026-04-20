import type { ImportedJiraTicket } from './types.js';

interface JiraIssueFields {
  summary?: unknown;
  status?: unknown;
  assignee?: unknown;
  description?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readName(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const displayName = value.displayName;
  if (typeof displayName === 'string' && displayName.trim()) {
    return displayName;
  }
  const name = value.name;
  if (typeof name === 'string' && name.trim()) {
    return name;
  }
  return null;
}

function adfNodeToText(node: unknown): string {
  if (!isRecord(node)) {
    return '';
  }

  if (typeof node.text === 'string') {
    return node.text;
  }

  const content = Array.isArray(node.content) ? node.content : [];
  const childText = content.map(adfNodeToText).join('');

  switch (node.type) {
    case 'doc':
      return content.map(adfNodeToText).filter(Boolean).join('\n\n');
    case 'paragraph':
    case 'heading':
    case 'blockquote':
      return childText.trimEnd();
    case 'bulletList':
    case 'orderedList':
      return content.map(adfNodeToText).filter(Boolean).join('\n');
    case 'listItem':
      return `- ${childText.trim()}`;
    case 'hardBreak':
      return '\n';
    case 'rule':
      return '\n---\n';
    case 'codeBlock':
      return childText.trimEnd();
    default:
      return childText;
  }
}

export function adfToPlainText(description: unknown): string {
  if (!description) {
    return '';
  }
  if (typeof description === 'string') {
    return description.trim();
  }
  return adfNodeToText(description)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeJiraTicket(issue: Record<string, unknown>, url: string): ImportedJiraTicket {
  const fields = isRecord(issue.fields) ? issue.fields as JiraIssueFields : {};
  const key = typeof issue.key === 'string' ? issue.key : '';
  const summary = typeof fields.summary === 'string' ? fields.summary : '';
  const status = readName(fields.status);
  const assignee = readName(fields.assignee);

  return {
    key,
    summary,
    status,
    assignee,
    description_text: adfToPlainText(fields.description),
    url,
  };
}
