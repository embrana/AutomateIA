import type { AgentBackend } from '../AgentBackend.js';
import type { AgentBackendConfig } from '../config.js';
import type { AgentInvocationRequest, AgentInvocationResult } from '../types.js';

export class ManualAgentBackend implements AgentBackend {
  readonly mode = 'manual' as const;

  async invoke(config: AgentBackendConfig, request: AgentInvocationRequest): Promise<AgentInvocationResult> {
    return {
      backend_name: request.backend_name,
      mode: this.mode,
      status: 'prepared',
      system_prompt: request.system_prompt,
      task_prompt: request.task_prompt,
      request_payload: {
        mode: this.mode,
        model: config.model ?? null,
        system_prompt: request.system_prompt ?? null,
        task_prompt: request.task_prompt,
        metadata: request.metadata ?? {},
      },
      notes: [
        'Manual backend selected: the runtime prepared the prompt and metadata but did not invoke an external model.',
      ],
    };
  }
}
