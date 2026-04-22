import type { AgentBackend } from '../AgentBackend.js';
import type { AgentBackendConfig } from '../config.js';
import type { AgentInvocationRequest, AgentInvocationResult } from '../types.js';
import { joinUrl, parseStructuredContent, resolveApiKey } from './shared.js';

export class OpenAICompatibleAgentBackend implements AgentBackend {
  readonly mode = 'openai_compatible' as const;

  async invoke(config: AgentBackendConfig, request: AgentInvocationRequest): Promise<AgentInvocationResult> {
    if (!config.base_url) {
      throw new Error(`Backend "${request.backend_name}" requires "base_url" for openai_compatible mode.`);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers ?? {}),
    };
    const apiKey = resolveApiKey(config);
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const requestPayload: Record<string, unknown> = {
      model: config.model ?? 'gpt-4.1-mini',
      messages: [
        ...(request.system_prompt
          ? [{ role: 'system', content: request.system_prompt }]
          : []),
        { role: 'user', content: request.task_prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    };

    const response = await fetch(joinUrl(config.base_url, config.request_path ?? 'v1/chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(config.timeout_ms ?? 60_000),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Backend "${request.backend_name}" returned ${response.status}: ${responseText.slice(0, 400)}`
      );
    }

    let responsePayload: unknown = responseText;
    try {
      responsePayload = JSON.parse(responseText);
    } catch {
      responsePayload = responseText;
    }

    const content =
      (responsePayload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;

    return {
      backend_name: request.backend_name,
      mode: this.mode,
      status: 'executed',
      system_prompt: request.system_prompt,
      task_prompt: request.task_prompt,
      request_payload: requestPayload,
      response_payload: responsePayload,
      structured_output: parseStructuredContent(content),
      notes: apiKey
        ? ['OpenAI-compatible backend executed with authenticated HTTP request.']
        : ['OpenAI-compatible backend executed without Authorization header.'],
    };
  }
}
