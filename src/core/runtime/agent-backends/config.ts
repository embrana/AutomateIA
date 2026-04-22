import type { AgentBackendRouteKey } from './routes.js';

export type AgentBackendMode =
  | 'openai_compatible'
  | 'command'
  | 'manual'
  | 'anthropic_native'
  | 'gemini_native';
export type GeminiTransport = 'developer_api' | 'vertex';
export type GeminiVertexAuth = 'auto' | 'access_token' | 'gcloud_adc' | 'gcloud_cli';
export type CommandBackendSandboxMode = 'read-only' | 'workspace-write';
export type CommandBackendImplementationMode = 'workspace_actions' | 'direct_edit';

export interface AgentBackendConfig {
  mode: AgentBackendMode;
  model?: string;
  base_url?: string;
  request_path?: string;
  api_key?: string;
  api_key_env?: string;
  access_token?: string;
  access_token_env?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  sandbox_mode?: CommandBackendSandboxMode;
  implementation_mode?: CommandBackendImplementationMode;
  max_tokens?: number;
  temperature?: number;
  anthropic_version?: string;
  api_version?: string;
  gemini_transport?: GeminiTransport;
  gemini_vertex_auth?: GeminiVertexAuth;
  project?: string;
  location?: string;
  publisher?: string;
  gcloud_bin?: string;
  timeout_ms?: number;
}

export interface AgentBackendRoutingConfig {
  default_backend?: string;
  routing?: Partial<Record<AgentBackendRouteKey, string>>;
  backends?: Record<string, AgentBackendConfig>;
}
