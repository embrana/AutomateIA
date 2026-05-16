export const AGENT_BACKEND_ROUTE_KEYS = [
  'context',
  'project_evidence',
  'root_spec',
  'root_spec_review',
  'spec',
  'planning',
  'implementation',
  'critic',
  'validation',
  'delivery',
] as const;

export type AgentBackendRouteKey = typeof AGENT_BACKEND_ROUTE_KEYS[number];

const ROUTE_KEYS_BY_AGENT_NAME: Record<string, AgentBackendRouteKey[]> = {
  context_agent: ['context'],
  project_evidence_resolver_agent: ['project_evidence'],
  root_spec_author_agent: ['root_spec'],
  root_spec_critic_agent: ['root_spec_review'],
  spec_agent: ['spec'],
  planning_agent: ['planning'],
  implementation_agent: ['implementation'],
  critic_agent: ['critic'],
  validation_agent: ['validation'],
  delivery_agent: ['delivery'],
};

export function routeKeysForAgentName(agentName: string): AgentBackendRouteKey[] {
  return ROUTE_KEYS_BY_AGENT_NAME[agentName] ?? [];
}
