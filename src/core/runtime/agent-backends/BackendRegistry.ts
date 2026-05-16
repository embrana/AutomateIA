import { getGlobalConfig } from '../../global-config.js';
import type { AgentName } from '../../../agents/base/Agent.js';
import type { GlobalConfig } from '../../global-config.js';
import type { AgentBackend } from './AgentBackend.js';
import type { AgentBackendRoutingConfig } from './config.js';
import type { ResolvedAgentBackend, AgentInvocationRequest, AgentInvocationResult } from './types.js';
import { routeKeysForAgentName } from './routes.js';
import { ManualAgentBackend } from './backends/ManualAgentBackend.js';
import { OpenAICompatibleAgentBackend } from './backends/OpenAICompatibleAgentBackend.js';
import { CommandAgentBackend } from './backends/CommandAgentBackend.js';
import { AnthropicNativeAgentBackend } from './backends/AnthropicNativeAgentBackend.js';
import { GeminiNativeAgentBackend } from './backends/GeminiNativeAgentBackend.js';

export class AgentBackendRegistry {
  private readonly backends: Record<string, AgentBackend>;

  constructor(
    private readonly configProvider: () => GlobalConfig = getGlobalConfig,
    backends?: Record<string, AgentBackend>
  ) {
    this.backends = backends ?? {
      manual: new ManualAgentBackend(),
      openai_compatible: new OpenAICompatibleAgentBackend(),
      command: new CommandAgentBackend(),
      anthropic_native: new AnthropicNativeAgentBackend(),
      gemini_native: new GeminiNativeAgentBackend(),
    };
  }

  resolveForAgent(
    agentName: AgentName,
    options: { allowDefaultFallback?: boolean } = {}
  ): ResolvedAgentBackend | null {
    const config = this.configProvider();
    const routing = config.agents;
    if (!routing) {
      return null;
    }

    const routeKeys = routeKeysForAgentName(agentName);
    const backendName = routeKeys
      .map((routeKey) => routing.routing?.[routeKey])
      .find((value): value is string => Boolean(value))
      ?? (options.allowDefaultFallback === false ? undefined : routing.default_backend);
    if (!backendName) {
      return null;
    }

    const backendConfig = routing.backends?.[backendName];
    if (!backendConfig) {
      throw new Error(`Configured backend "${backendName}" for ${agentName} was not found in agents.backends.`);
    }

    return {
      name: backendName,
      config: backendConfig,
    };
  }

  invoke(resolvedBackend: ResolvedAgentBackend, request: Omit<AgentInvocationRequest, 'backend_name' | 'mode'>): Promise<AgentInvocationResult> {
    const runtimeBackend = this.backends[resolvedBackend.config.mode];
    if (!runtimeBackend) {
      throw new Error(`Backend mode "${resolvedBackend.config.mode}" is not supported.`);
    }

    return runtimeBackend.invoke(resolvedBackend.config, {
      ...request,
      backend_name: resolvedBackend.name,
      mode: resolvedBackend.config.mode,
    });
  }

  getRoutingSnapshot(): AgentBackendRoutingConfig | undefined {
    return this.configProvider().agents;
  }
}
