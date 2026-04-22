export const AGENT_BACKEND_ROUTE_KEYS = [
  'context',
  'spec',
  'planning',
  'implementation',
  'critic',
  'validation',
  'delivery',
] as const;

export type AgentBackendRouteKey = typeof AGENT_BACKEND_ROUTE_KEYS[number];

const ROUTE_KEY_BY_AGENT_NAME: Record<string, AgentBackendRouteKey> = {
  context_agent: 'context',
  spec_agent: 'spec',
  planning_agent: 'planning',
  implementation_agent: 'implementation',
  critic_agent: 'critic',
  validation_agent: 'validation',
  delivery_agent: 'delivery',
};

export function routeKeyForAgentName(agentName: string): AgentBackendRouteKey | undefined {
  return ROUTE_KEY_BY_AGENT_NAME[agentName];
}
