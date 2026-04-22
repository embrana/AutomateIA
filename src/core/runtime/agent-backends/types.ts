import type { AgentBudget, AgentConstraints, AgentName } from '../../../agents/base/Agent.js';
import type { AgentBackendConfig, AgentBackendMode } from './config.js';

export interface AgentInvocationRequest {
  agent_name: AgentName;
  backend_name: string;
  mode: AgentBackendMode;
  workspace_root: string;
  change_name?: string;
  input_refs: string[];
  constraints: AgentConstraints;
  budget?: AgentBudget;
  system_prompt?: string;
  task_prompt: string;
  metadata?: Record<string, unknown>;
}

export interface AgentInvocationResult {
  backend_name: string;
  mode: AgentBackendMode;
  status: 'prepared' | 'executed';
  system_prompt?: string;
  task_prompt: string;
  request_payload?: Record<string, unknown>;
  response_payload?: unknown;
  structured_output?: Record<string, unknown> | null;
  notes: string[];
}

export interface ResolvedAgentBackend {
  name: string;
  config: AgentBackendConfig;
}
