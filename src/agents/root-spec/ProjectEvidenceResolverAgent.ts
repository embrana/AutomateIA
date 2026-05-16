import { promises as fs } from 'fs';
import path from 'path';
import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';

export interface ProjectEvidenceSummary {
  repository_summary: string;
  documentation_refs: string[];
  api_contract_refs: string[];
  data_model_refs: string[];
  migration_refs: string[];
  test_refs: string[];
  module_refs: string[];
  impacted_layers: string[];
  technical_constraints: string[];
  unresolved_technical_tbds: string[];
}

interface CandidateRef {
  ref: string;
  score: number;
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.pnpm-store',
  '.turbo',
  '.next',
  'dist',
  'build',
  'coverage',
]);

const MAX_FILES = 250;
const MAX_DEPTH = 5;

function toProjectRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function scorePath(relativePath: string, normalizedContext: NormalizedContext): number {
  const lowerPath = relativePath.toLowerCase();
  let score = 0;

  const tokens = [
    ...normalizedContext.acceptance_criteria,
    ...normalizedContext.business_rules,
    normalizedContext.problem_statement,
  ]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);

  for (const token of new Set(tokens)) {
    if (lowerPath.includes(token)) {
      score += token.length;
    }
  }

  if (lowerPath.includes('spec')) score += 3;
  if (lowerPath.includes('api') || lowerPath.includes('openapi') || lowerPath.includes('swagger')) score += 4;
  if (lowerPath.includes('schema') || lowerPath.includes('prisma')) score += 4;
  if (lowerPath.includes('migration') || lowerPath.endsWith('.sql')) score += 4;
  if (lowerPath.includes('test')) score += 2;
  if (lowerPath.includes('docs/')) score += 2;
  return score;
}

async function walkRepository(
  projectRoot: string,
  directory: string,
  normalizedContext: NormalizedContext,
  depth = 0,
  results: CandidateRef[] = []
): Promise<CandidateRef[]> {
  if (depth > MAX_DEPTH || results.length >= MAX_FILES) {
    return results;
  }

  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= MAX_FILES) {
      break;
    }

    const fullPath = path.join(directory, entry.name);
    const relativePath = toProjectRelative(projectRoot, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || relativePath.startsWith('.openspec/runtime/')) {
        continue;
      }
      if (relativePath.startsWith('openspec/changes/')) {
        continue;
      }
      await walkRepository(projectRoot, fullPath, normalizedContext, depth + 1, results);
      continue;
    }

    results.push({
      ref: relativePath,
      score: scorePath(relativePath, normalizedContext),
    });
  }

  return results;
}

function classifyLayer(relativePath: string): string | null {
  const lowerPath = relativePath.toLowerCase();
  if (lowerPath.includes('/mobile/') || lowerPath.startsWith('mobile/')) return 'mobile';
  if (lowerPath.includes('/web/') || lowerPath.startsWith('web/')) return 'web';
  if (lowerPath.includes('/backoffice/') || lowerPath.startsWith('backoffice/')) return 'backoffice';
  if (lowerPath.includes('/infra/') || lowerPath.startsWith('infra/')) return 'infra';
  if (lowerPath.includes('/shared/') || lowerPath.startsWith('shared/')) return 'shared';
  if (lowerPath.startsWith('src/') || lowerPath.includes('/api/') || lowerPath.includes('/server/')) return 'backend';
  return null;
}

function limitRefs(values: CandidateRef[], matcher: (value: string) => boolean, max = 12): string[] {
  return values
    .filter((entry) => matcher(entry.ref))
    .sort((left, right) => right.score - left.score || left.ref.localeCompare(right.ref))
    .slice(0, max)
    .map((entry) => entry.ref);
}

function buildTechnicalConstraints(summary: ProjectEvidenceSummary): string[] {
  const constraints: string[] = [];
  if (summary.api_contract_refs.length > 0) {
    constraints.push(`Project API contracts were identified in: ${summary.api_contract_refs.join(', ')}`);
  }
  if (summary.data_model_refs.length > 0) {
    constraints.push(`Project data model artifacts were identified in: ${summary.data_model_refs.join(', ')}`);
  }
  if (summary.migration_refs.length > 0) {
    constraints.push(`Existing schema migration history is present in: ${summary.migration_refs.join(', ')}`);
  }
  if (summary.impacted_layers.length > 0) {
    constraints.push(`Impacted project layers inferred from repository evidence: ${summary.impacted_layers.join(', ')}`);
  }
  if (summary.test_refs.length > 0) {
    constraints.push(`Existing automated test surfaces were found in: ${summary.test_refs.join(', ')}`);
  }
  return constraints;
}

export class ProjectEvidenceResolverAgent implements Agent<NormalizedContext, ProjectEvidenceSummary> {
  readonly name = 'project_evidence_resolver_agent' as const;

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.ticket.key);
  }

  async run(
    input: NormalizedContext,
    context: AgentContext
  ): Promise<AgentResultEnvelope<ProjectEvidenceSummary>> {
    const discovered = await walkRepository(context.projectRoot, context.projectRoot, input);
    const ranked = discovered
      .sort((left, right) => right.score - left.score || left.ref.localeCompare(right.ref))
      .slice(0, MAX_FILES);

    const documentationRefs = limitRefs(ranked, (ref) =>
      ref.startsWith('docs/')
      || ref.startsWith('README')
      || ref.endsWith('.md')
      || ref.startsWith('openspec/specs/')
    );
    const apiContractRefs = limitRefs(ranked, (ref) =>
      ref.includes('openapi')
      || ref.includes('swagger')
      || ref.endsWith('.graphql')
      || ref.endsWith('api.ts')
      || ref.includes('/api/')
    );
    const dataModelRefs = limitRefs(ranked, (ref) =>
      ref.endsWith('schema.prisma')
      || ref.endsWith('.prisma')
      || ref.includes('/models/')
      || ref.includes('/entities/')
      || ref.includes('/schema/')
      || ref.endsWith('drizzle.config.ts')
    );
    const migrationRefs = limitRefs(ranked, (ref) =>
      ref.includes('migration')
      || ref.endsWith('.sql')
    );
    const testRefs = limitRefs(ranked, (ref) =>
      ref.includes('test/')
      || ref.includes('__tests__')
      || ref.endsWith('.test.ts')
      || ref.endsWith('.spec.ts')
    );
    const moduleRefs = ranked
      .filter((entry) => entry.score > 0)
      .slice(0, 20)
      .map((entry) => entry.ref);
    const impactedLayers = uniqueSorted(moduleRefs
      .map((ref) => classifyLayer(ref))
      .filter((value): value is string => Boolean(value)));

    const summary: ProjectEvidenceSummary = {
      repository_summary: [
        `Repository scan completed for ticket ${context.envelope.ticket_key}.`,
        `Top evidence candidates considered: ${moduleRefs.length}.`,
        impactedLayers.length > 0
          ? `Likely affected layers: ${impactedLayers.join(', ')}.`
          : 'No project layers could be inferred confidently from repository structure.',
      ].join(' '),
      documentation_refs: documentationRefs,
      api_contract_refs: apiContractRefs,
      data_model_refs: dataModelRefs,
      migration_refs: migrationRefs,
      test_refs: testRefs,
      module_refs: moduleRefs,
      impacted_layers: impactedLayers,
      technical_constraints: [],
      unresolved_technical_tbds: [],
    };
    summary.technical_constraints = buildTechnicalConstraints(summary);
    summary.unresolved_technical_tbds = [
      ...(summary.api_contract_refs.length === 0 ? ['TBD: no explicit API contract artifact was discovered in the repository scan.'] : []),
      ...(summary.data_model_refs.length === 0 ? ['TBD: no explicit data model or schema artifact was discovered in the repository scan.'] : []),
    ];

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output: summary,
      artifact_refs: [],
      recommended_next_action: 'RUN_ROOT_SPEC_AUTHOR_AGENT',
    };
  }
}
