import type { AgentBackendConfig } from './config.js';
import type { AgentInvocationRequest, AgentInvocationResult } from './types.js';

export interface AgentBackend {
  readonly mode: AgentBackendConfig['mode'];
  invoke(config: AgentBackendConfig, request: AgentInvocationRequest): Promise<AgentInvocationResult>;
}
