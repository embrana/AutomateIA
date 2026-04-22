import fg from 'fast-glob';
import type {
  Agent,
  AgentContext,
  AgentResultEnvelope,
  NormalizedContext,
} from '../base/Agent.js';

export interface ExecutionPlanStep {
  id: string;
  title: string;
  owner: 'implementation_agent';
}

export interface ExecutionPlan {
  objective: string;
  steps: ExecutionPlanStep[];
  files_likely_affected: string[];
  test_strategy: string[];
  rollback_strategy: string;
  estimated_risk: 'low' | 'medium' | 'high';
}

export interface PlanningAgentOutput {
  execution_plan: ExecutionPlan;
}

function tokenize(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
  )];
}

function determineRisk(context: NormalizedContext): 'low' | 'medium' | 'high' {
  const haystack = `${context.problem_statement} ${context.risks.join(' ')} ${context.acceptance_criteria.join(' ')}`.toLowerCase();
  if (/(auth|payment|security|migration|production data)/.test(haystack)) {
    return 'high';
  }
  if (/(archive|worklog|runtime|session|orchestrat|jira|validation)/.test(haystack)) {
    return 'medium';
  }
  return 'low';
}

async function rankFiles(projectRoot: string, searchText: string): Promise<string[]> {
  const candidates = await fg([
    'src/**/*.{ts,tsx,js,jsx}',
    'test/**/*.{ts,tsx,js,jsx}',
    'openspec/specs/**/spec.md',
  ], {
    cwd: projectRoot,
    onlyFiles: true,
    dot: false,
    ignore: ['dist/**', 'node_modules/**'],
  });

  const tokens = tokenize(searchText);
  const scored = candidates
    .map((file) => {
      const lower = file.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lower.includes(token)) {
          score += 2;
        }
      }
      if (lower.includes('test')) {
        score += 1;
      }
      if (lower.includes('cli/index') || lower.includes('core/timer') || lower.includes('core/runtime')) {
        score += 1;
      }
      return { file, score };
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const topMatches = scored.filter((entry) => entry.score > 0).slice(0, 5).map((entry) => entry.file);
  if (topMatches.length > 0) {
    return topMatches;
  }

  const fallback = [
    'src/cli/index.ts',
    'src/core/timer/commands.ts',
    'src/core/runtime/session/SessionManager.ts',
    'test/core/timer.test.ts',
  ];
  return fallback.filter((file) => candidates.includes(file)).slice(0, 5);
}

export class PlanningAgent implements Agent<NormalizedContext | undefined, PlanningAgentOutput> {
  readonly name = 'planning_agent' as const;

  async canRun(context: AgentContext): Promise<boolean> {
    return Boolean(context.runtimeSnapshot.session.change_name);
  }

  async run(input: NormalizedContext | undefined, context: AgentContext): Promise<AgentResultEnvelope<PlanningAgentOutput>> {
    const normalizedContext = input ?? context.existingNormalizedContext;
    if (!normalizedContext) {
      throw new Error('PlanningAgent requires a normalized context artifact. Run the context agent first.');
    }
    if (!context.runtimeSnapshot.session.change_name) {
      throw new Error('PlanningAgent requires an active change. Run the spec agent first.');
    }

    const objective = context.ticket.summary;
    const filesLikelyAffected = await rankFiles(
      context.projectRoot,
      `${context.ticket.summary} ${normalizedContext.problem_statement} ${normalizedContext.acceptance_criteria.join(' ')}`
    );
    const estimatedRisk = determineRisk(normalizedContext);
    const executionPlan: ExecutionPlan = {
      objective,
      steps: [
        {
          id: 'P1',
          title: `Align change artifacts and runtime assumptions for ${context.runtimeSnapshot.session.change_name}`,
          owner: 'implementation_agent',
        },
        {
          id: 'P2',
          title: `Implement the requested behavior and any supporting code paths`,
          owner: 'implementation_agent',
        },
        {
          id: 'P3',
          title: `Add or update tests and validate against acceptance criteria`,
          owner: 'implementation_agent',
        },
      ],
      files_likely_affected: filesLikelyAffected,
      test_strategy: ['unit_tests', 'integration_tests', 'openspec_validate'],
      rollback_strategy: 'revert_change_and_restore_previous_cli_behavior',
      estimated_risk: estimatedRisk,
    };

    const requiresApproval = estimatedRisk === 'high' || normalizedContext.ambiguities.length > 0;

    return {
      agent_name: this.name,
      status: 'SUCCEEDED',
      output: {
        execution_plan: executionPlan,
      },
      artifact_refs: [],
      recommended_next_action: requiresApproval ? 'REQUEST_HUMAN_APPROVAL' : 'RUN_IMPLEMENTATION_AGENT',
    };
  }
}
