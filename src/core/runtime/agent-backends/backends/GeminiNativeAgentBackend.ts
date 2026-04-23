import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentBackend } from '../AgentBackend.js';
import type { AgentBackendConfig, GeminiTransport, GeminiVertexAuth } from '../config.js';
import type { AgentInvocationRequest, AgentInvocationResult } from '../types.js';
import { joinUrl, parseStructuredContent, resolveAccessToken, resolveApiKey } from './shared.js';

const execFileAsync = promisify(execFile);

function inferGeminiTransport(config: AgentBackendConfig): GeminiTransport {
  if (config.gemini_transport) {
    return config.gemini_transport;
  }
  if (config.project || config.location || config.access_token || config.access_token_env) {
    return 'vertex';
  }
  return 'developer_api';
}

function buildPayload(config: AgentBackendConfig, request: AgentInvocationRequest): Record<string, unknown> {
  return {
    ...(request.system_prompt
      ? {
          systemInstruction: {
            parts: [{ text: request.system_prompt }],
          },
        }
      : {}),
    contents: [
      {
        role: 'user',
        parts: [{ text: request.task_prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: config.temperature ?? 0.1,
      ...(config.max_tokens ? { maxOutputTokens: config.max_tokens } : {}),
    },
  };
}

function extractGeminiText(responsePayload: unknown): string | undefined {
  const parts =
    (responsePayload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })?.candidates?.[0]
      ?.content?.parts;
  if (!Array.isArray(parts)) {
    return undefined;
  }
  const text = parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
  return text || undefined;
}

function inferVertexAuthStrategy(config: AgentBackendConfig): GeminiVertexAuth {
  return config.gemini_vertex_auth ?? 'auto';
}

export interface ResolvedGeminiVertexAccessToken {
  token: string;
  source: 'config' | 'env' | 'gcloud_adc' | 'gcloud_cli';
}

export async function resolveGeminiVertexAccessToken(
  config: AgentBackendConfig,
  execFileImpl: typeof execFileAsync = execFileAsync
): Promise<ResolvedGeminiVertexAccessToken> {
  const authStrategy = inferVertexAuthStrategy(config);

  const fromConfig = resolveAccessToken(config);
  if (fromConfig) {
    return {
      token: fromConfig,
      source: 'config',
    };
  }

  const envAccessToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (envAccessToken && authStrategy === 'auto') {
    return {
      token: envAccessToken,
      source: 'env',
    };
  }

  const gcloudBin = config.gcloud_bin ?? 'gcloud';
  const tryCommand = async (
    args: string[],
    source: 'gcloud_adc' | 'gcloud_cli'
  ): Promise<ResolvedGeminiVertexAccessToken | null> => {
    try {
      const result = await execFileImpl(gcloudBin, args, {
        encoding: 'utf8',
      });
      const token = result.stdout.trim();
      if (!token) {
        return null;
      }
      return {
        token,
        source,
      };
    } catch {
      return null;
    }
  };

  if (authStrategy === 'auto' || authStrategy === 'gcloud_adc') {
    const adcToken = await tryCommand(['auth', 'application-default', 'print-access-token'], 'gcloud_adc');
    if (adcToken) {
      return adcToken;
    }
    if (authStrategy === 'gcloud_adc') {
      throw new Error(
        'Gemini Vertex auth strategy "gcloud_adc" failed. Run `gcloud auth application-default login` or provide an access token explicitly.'
      );
    }
  }

  if (authStrategy === 'auto' || authStrategy === 'gcloud_cli') {
    const cliToken = await tryCommand(['auth', 'print-access-token'], 'gcloud_cli');
    if (cliToken) {
      return cliToken;
    }
    if (authStrategy === 'gcloud_cli') {
      throw new Error(
        'Gemini Vertex auth strategy "gcloud_cli" failed. Run `gcloud auth login` or provide an access token explicitly.'
      );
    }
  }

  throw new Error(
    'Gemini Vertex auth could not resolve credentials. Provide access_token/access_token_env, set GOOGLE_OAUTH_ACCESS_TOKEN, run `gcloud auth application-default login`, or run `gcloud auth login`.'
  );
}

function buildDeveloperUrl(config: AgentBackendConfig): string {
  const model = config.model ?? 'gemini-2.5-flash';
  const requestPath = config.request_path ?? `${config.api_version ?? 'v1beta'}/models/${model}:generateContent`;
  return joinUrl(config.base_url ?? 'https://generativelanguage.googleapis.com', requestPath);
}

function buildVertexUrl(config: AgentBackendConfig): string {
  const model = config.model ?? 'gemini-2.5-flash';
  const project = config.project;
  const location = config.location;
  if (!project || !location) {
    throw new Error(
      'gemini_native vertex mode requires both "project" and "location" in the backend config.'
    );
  }
  const requestPath =
    config.request_path
    ?? `${config.api_version ?? 'v1'}/projects/${project}/locations/${location}/publishers/${config.publisher ?? 'google'}/models/${model}:generateContent`;
  return joinUrl(config.base_url ?? `https://${location}-aiplatform.googleapis.com`, requestPath);
}

export class GeminiNativeAgentBackend implements AgentBackend {
  readonly mode = 'gemini_native' as const;

  constructor(
    private readonly vertexTokenResolver: (
      config: AgentBackendConfig
    ) => Promise<ResolvedGeminiVertexAccessToken> = resolveGeminiVertexAccessToken
  ) {}

  async invoke(config: AgentBackendConfig, request: AgentInvocationRequest): Promise<AgentInvocationResult> {
    const transport = inferGeminiTransport(config);
    const requestPayload = buildPayload(config, request);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers ?? {}),
    };

    let url: string;
    let authSource: ResolvedGeminiVertexAccessToken['source'] | 'api_key' | undefined;
    if (transport === 'vertex') {
      const resolvedAccess = await this.vertexTokenResolver(config);
      headers.Authorization = `Bearer ${resolvedAccess.token}`;
      authSource = resolvedAccess.source;
      url = buildVertexUrl(config);
    } else {
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error(
          `Backend "${request.backend_name}" requires "api_key" or "api_key_env" for gemini_native developer_api mode.`
        );
      }
      headers['x-goog-api-key'] = apiKey;
      authSource = 'api_key';
      url = buildDeveloperUrl(config);
    }

    const response = await fetch(url, {
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

    return {
      backend_name: request.backend_name,
      mode: this.mode,
      status: 'executed',
      system_prompt: request.system_prompt,
      task_prompt: request.task_prompt,
      request_payload: requestPayload,
      response_payload: responsePayload,
      structured_output: parseStructuredContent(extractGeminiText(responsePayload)),
      usage: {
        input_tokens:
          (responsePayload as { usageMetadata?: { promptTokenCount?: unknown } })?.usageMetadata?.promptTokenCount as number | null | undefined,
        output_tokens:
          (responsePayload as { usageMetadata?: { candidatesTokenCount?: unknown } })?.usageMetadata?.candidatesTokenCount as number | null | undefined,
      },
      notes: [
        transport === 'vertex'
          ? `Gemini Vertex backend executed with Bearer authentication (${authSource ?? 'unknown'} source).`
          : 'Gemini Developer API backend executed with x-goog-api-key authentication.',
      ],
    };
  }
}
