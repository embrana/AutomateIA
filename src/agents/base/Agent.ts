import type { ImportedJiraTicket, TimerSession } from '../../core/timer/types.js';
import type { ProjectConfig } from '../../core/project-config.js';
import type { RuntimeSnapshot } from '../../core/runtime/types.js';
import type { SessionManager } from '../../core/runtime/session/SessionManager.js';

export type AgentName =
  | 'context_agent'
  | 'spec_agent'
  | 'planning_agent'
  | 'implementation_agent'
  | 'critic_agent'
  | 'validation_agent'
  | 'delivery_agent';

export type NextAction =
  | 'RUN_CONTEXT_AGENT'
  | 'RUN_SPEC_AGENT'
  | 'RUN_PLANNING_AGENT'
  | 'RUN_IMPLEMENTATION_AGENT'
  | 'RUN_CRITIC_AGENT'
  | 'RUN_VALIDATION_AGENT'
  | 'RUN_DELIVERY_AGENT'
  | 'REQUEST_HUMAN_APPROVAL'
  | 'REQUEST_ARCHIVE_APPROVAL'
  | 'OPEN_RECOVERY_FLOW'
  | 'STOP';

export interface AgentConstraints {
  canReadJira: boolean;
  canEditSpecs: boolean;
  canEditCode: boolean;
  canRunValidation: boolean;
  canCommentJira: boolean;
  canArchive: boolean;
  maxFilesToEdit?: number;
  maxDiffLines?: number;
  highRiskPaths?: string[];
}

export interface AgentBudget {
  maxMinutes?: number;
  maxRetriesRemaining?: number;
}

export interface AgentRunEnvelope {
  run_id: string;
  agent_name: AgentName;
  ticket_key: string;
  session_id: string;
  cycle_id: string;
  autonomy_level: RuntimeSnapshot['session']['autonomy_level'];
  workspace_root: string;
  change_name?: string;
  input_refs: string[];
  constraints: AgentConstraints;
  budget?: AgentBudget;
}

export interface NormalizedContext {
  problem_statement: string;
  acceptance_criteria: string[];
  business_rules: string[];
  data_contracts: string[];
  integrations: string[];
  out_of_scope: string[];
  ambiguities: string[];
  risks: string[];
  source_summary: string;
}

export interface AgentContext {
  projectRoot: string;
  envelope: AgentRunEnvelope;
  timerSession: TimerSession;
  runtimeSnapshot: RuntimeSnapshot;
  ticket: ImportedJiraTicket;
  projectConfig: ProjectConfig | null;
  existingNormalizedContext?: NormalizedContext;
  sessionManager: SessionManager;
}

export interface AgentResultEnvelope<TOutput> {
  agent_name: AgentName;
  status: 'SUCCEEDED' | 'FAILED' | 'ESCALATED' | 'REJECTED' | 'SKIPPED';
  output: TOutput;
  artifact_refs: string[];
  human_questions?: string[];
  recommended_next_action: NextAction;
}

export interface Agent<Input, Output> {
  name: AgentName;
  canRun(context: AgentContext): Promise<boolean>;
  run(input: Input, context: AgentContext): Promise<AgentResultEnvelope<Output>>;
}
