import type { AgentBackend } from '../AgentBackend.js';
import type { AgentBackendConfig } from '../config.js';
import type { AgentInvocationRequest, AgentInvocationResult } from '../types.js';
import { joinUrl, parseStructuredContent, resolveApiKey } from './shared.js';

function extractTextContent(responsePayload: unknown): string | undefined {
  const content = (responsePayload as { content?: Array<{ type?: string; text?: unknown }> })?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
  return text || undefined;
}

export class AnthropicNativeAgentBackend implements AgentBackend {
  readonly mode = 'anthropic_native' as const;

  async invoke(config: AgentBackendConfig, request: AgentInvocationRequest): Promise<AgentInvocationResult> {
    const apiKey = resolveApiKey(config);
    if (!apiKey) {
      throw new Error(
        `Backend "${request.backend_name}" requires "api_key" or "api_key_env" for anthropic_native mode.`
      );
    }

    const requestPayload: Record<string, unknown> = {
      model: config.model ?? 'claude-sonnet-4-20250514',
      max_tokens: config.max_tokens ?? 1024,
      messages: [
        {
          role: 'user',
          content: request.task_prompt,
        },
      ],
      temperature: config.temperature ?? 0.1,
      ...(request.system_prompt ? { system: request.system_prompt } : {}),
    };

    const response = await fetch(
      joinUrl(config.base_url ?? 'https://api.anthropic.com', config.request_path ?? '/v1/messages'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': config.anthropic_version ?? '2023-06-01',
          ...(config.headers ?? {}),
        },
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(config.timeout_ms ?? 60_000),
      }
    );

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

    const textContent = extractTextContent(responsePayload);

    return {
      backend_name: request.backend_name,
      mode: this.mode,
      status: 'executed',
      system_prompt: request.system_prompt,
      task_prompt: request.task_prompt,
      request_payload: requestPayload,
      response_payload: responsePayload,
      structured_output: parseStructuredContent(textContent),
      usage: {
        input_tokens:
          (responsePayload as { usage?: { input_tokens?: unknown } })?.usage?.input_tokens as number | null | undefined,
        output_tokens:
          (responsePayload as { usage?: { output_tokens?: unknown } })?.usage?.output_tokens as number | null | undefined,
      },
      notes: [
        'Anthropic Messages API backend executed with x-api-key authentication.',
      ],
    };
  }
}
