import type { AgentBackendConfig } from '../config.js';

export function joinUrl(baseUrl: string, requestPath: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = requestPath.replace(/^\//, '');
  return new URL(normalizedPath, normalizedBase).toString();
}

export function parseStructuredContent(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveSecretValue(
  directValue: string | undefined,
  envVarName: string | undefined
): string | undefined {
  if (directValue) {
    return directValue;
  }
  if (envVarName) {
    return process.env[envVarName];
  }
  return undefined;
}

export function resolveApiKey(config: AgentBackendConfig): string | undefined {
  return resolveSecretValue(config.api_key, config.api_key_env);
}

export function resolveAccessToken(config: AgentBackendConfig): string | undefined {
  return resolveSecretValue(config.access_token, config.access_token_env);
}
