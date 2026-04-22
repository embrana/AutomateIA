import { z } from 'zod';
import { AGENT_BACKEND_ROUTE_KEYS } from './runtime/agent-backends/routes.js';

/**
 * Zod schema for global OpenSpec configuration.
 * Uses passthrough() to preserve unknown fields for forward compatibility.
 */
export const GlobalConfigSchema = z
  .object({
    featureFlags: z
      .record(z.string(), z.boolean())
      .optional()
      .default({}),
    profile: z
      .enum(['core', 'custom'])
      .optional()
      .default('core'),
    delivery: z
      .enum(['both', 'skills', 'commands'])
      .optional()
      .default('both'),
    workflows: z
      .array(z.string())
      .optional(),
    jira: z
      .object({
        base_url: z.string().url().optional(),
        email: z.string().min(1).optional(),
        api_token: z.string().min(1).optional(),
        default_project: z.string().min(1).optional(),
      })
      .optional()
      .default({}),
    worklog: z
      .object({
        author_display: z.string().optional(),
        rounding: z.enum(['minute', 'none']).optional().default('minute'),
        min_seconds: z.number().int().min(0).optional().default(60),
        comment_template: z.string().min(1).optional().default('OpenSpec execution session'),
        track_metadata_locally: z.boolean().optional().default(true),
      })
      .optional()
      .default({
        rounding: 'minute',
        min_seconds: 60,
        comment_template: 'OpenSpec execution session',
        track_metadata_locally: true,
      }),
    agents: z
      .object({
        default_backend: z.string().min(1).optional(),
        routing: z
          .object(
            Object.fromEntries(
              AGENT_BACKEND_ROUTE_KEYS.map((key) => [key, z.string().min(1).optional()])
            ) as Record<(typeof AGENT_BACKEND_ROUTE_KEYS)[number], z.ZodOptional<z.ZodString>>
          )
          .partial()
          .optional()
          .default({}),
        backends: z
          .record(
            z.string(),
            z.object({
              mode: z.enum(['openai_compatible', 'command', 'manual', 'anthropic_native', 'gemini_native']),
              model: z.string().min(1).optional(),
              base_url: z.string().url().optional(),
              request_path: z.string().min(1).optional(),
              api_key: z.string().min(1).optional(),
              api_key_env: z.string().min(1).optional(),
              access_token: z.string().min(1).optional(),
              access_token_env: z.string().min(1).optional(),
              headers: z.record(z.string(), z.string()).optional(),
              command: z.string().min(1).optional(),
              args: z.array(z.string()).optional(),
              env: z.record(z.string(), z.string()).optional(),
              sandbox_mode: z.enum(['read-only', 'workspace-write']).optional(),
              implementation_mode: z.enum(['workspace_actions', 'direct_edit']).optional(),
              max_tokens: z.number().int().positive().optional(),
              temperature: z.number().min(0).max(2).optional(),
              anthropic_version: z.string().min(1).optional(),
              api_version: z.string().min(1).optional(),
              gemini_transport: z.enum(['developer_api', 'vertex']).optional(),
              gemini_vertex_auth: z.enum(['auto', 'access_token', 'gcloud_adc', 'gcloud_cli']).optional(),
              project: z.string().min(1).optional(),
              location: z.string().min(1).optional(),
              publisher: z.string().min(1).optional(),
              gcloud_bin: z.string().min(1).optional(),
              timeout_ms: z.number().int().positive().optional(),
            }).passthrough()
          )
          .optional()
          .default({}),
      })
      .optional()
      .default({
        routing: {},
        backends: {},
      }),
  })
  .passthrough();

export type GlobalConfigType = z.infer<typeof GlobalConfigSchema>;

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: GlobalConfigType = {
  featureFlags: {},
  profile: 'core',
  delivery: 'both',
  agents: {
    routing: {},
    backends: {},
  },
  jira: {},
  worklog: {
    rounding: 'minute',
    min_seconds: 60,
    comment_template: 'OpenSpec execution session',
    track_metadata_locally: true,
  },
};

const KNOWN_TOP_LEVEL_KEYS = new Set([...Object.keys(DEFAULT_CONFIG), 'workflows']);
const JIRA_KEYS = new Set(['base_url', 'email', 'api_token', 'default_project']);
const WORKLOG_KEYS = new Set([
  'author_display',
  'rounding',
  'min_seconds',
  'comment_template',
  'track_metadata_locally',
]);
const AGENTS_KEYS = new Set(['default_backend', 'routing', 'backends']);
const AGENT_ROUTING_KEYS = new Set<string>(AGENT_BACKEND_ROUTE_KEYS);
const AGENT_BACKEND_KEYS = new Set([
  'mode',
  'model',
  'base_url',
  'request_path',
  'api_key',
  'api_key_env',
  'access_token',
  'access_token_env',
  'headers',
  'command',
  'args',
  'env',
  'sandbox_mode',
  'implementation_mode',
  'max_tokens',
  'temperature',
  'anthropic_version',
  'api_version',
  'gemini_transport',
  'gemini_vertex_auth',
  'project',
  'location',
  'publisher',
  'gcloud_bin',
  'timeout_ms',
]);

/**
 * Validate a config key path for CLI set operations.
 * Unknown top-level keys are rejected unless explicitly allowed by the caller.
 */
export function validateConfigKeyPath(path: string): { valid: boolean; reason?: string } {
  const rawKeys = path.split('.');

  if (rawKeys.length === 0 || rawKeys.some((key) => key.trim() === '')) {
    return { valid: false, reason: 'Key path must not be empty' };
  }

  const rootKey = rawKeys[0];
  if (!KNOWN_TOP_LEVEL_KEYS.has(rootKey)) {
    return { valid: false, reason: `Unknown top-level key "${rootKey}"` };
  }

  if (rootKey === 'featureFlags') {
    if (rawKeys.length > 2) {
      return { valid: false, reason: 'featureFlags values are booleans and do not support nested keys' };
    }
    return { valid: true };
  }

  if (rootKey === 'jira') {
    if (rawKeys.length === 1) {
      return { valid: true };
    }
    if (rawKeys.length > 2) {
      return { valid: false, reason: 'jira values do not support deeply nested keys' };
    }
    if (!JIRA_KEYS.has(rawKeys[1])) {
      return { valid: false, reason: `Unknown jira key "${rawKeys[1]}"` };
    }
    return { valid: true };
  }

  if (rootKey === 'worklog') {
    if (rawKeys.length === 1) {
      return { valid: true };
    }
    if (rawKeys.length > 2) {
      return { valid: false, reason: 'worklog values do not support deeply nested keys' };
    }
    if (!WORKLOG_KEYS.has(rawKeys[1])) {
      return { valid: false, reason: `Unknown worklog key "${rawKeys[1]}"` };
    }
    return { valid: true };
  }

  if (rootKey === 'agents') {
    if (rawKeys.length === 1) {
      return { valid: true };
    }
    if (!AGENTS_KEYS.has(rawKeys[1])) {
      return { valid: false, reason: `Unknown agents key "${rawKeys[1]}"` };
    }
    if (rawKeys[1] === 'default_backend') {
      return rawKeys.length === 2
        ? { valid: true }
        : { valid: false, reason: 'agents.default_backend does not support nested keys' };
    }
    if (rawKeys[1] === 'routing') {
      if (rawKeys.length === 2) {
        return { valid: true };
      }
      if (rawKeys.length !== 3) {
        return { valid: false, reason: 'agents.routing values do not support deeply nested keys' };
      }
      if (!AGENT_ROUTING_KEYS.has(rawKeys[2])) {
        return { valid: false, reason: `Unknown agent routing key "${rawKeys[2]}"` };
      }
      return { valid: true };
    }
    if (rawKeys[1] === 'backends') {
      if (rawKeys.length < 3) {
        return { valid: true };
      }
      if (rawKeys.length === 3) {
        return { valid: true };
      }
      if (!AGENT_BACKEND_KEYS.has(rawKeys[3])) {
        return { valid: false, reason: `Unknown backend config key "${rawKeys[3]}"` };
      }
      if (rawKeys[3] === 'headers' || rawKeys[3] === 'env') {
        if (rawKeys.length > 5) {
          return { valid: false, reason: `${rawKeys.slice(0, 4).join('.')} does not support deeply nested keys` };
        }
        return { valid: true };
      }
      if (rawKeys.length > 4) {
        return { valid: false, reason: `${rawKeys.slice(0, 4).join('.')} does not support nested keys` };
      }
      return { valid: true };
    }
  }

  if (rawKeys.length > 1) {
    return { valid: false, reason: `"${rootKey}" does not support nested keys` };
  }

  return { valid: true };
}

/**
 * Get a nested value from an object using dot notation.
 *
 * @param obj - The object to access
 * @param path - Dot-separated path (e.g., "featureFlags.someFlag")
 * @returns The value at the path, or undefined if not found
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Set a nested value in an object using dot notation.
 * Creates intermediate objects as needed.
 *
 * @param obj - The object to modify (mutated in place)
 * @param path - Dot-separated path (e.g., "featureFlags.someFlag")
 * @param value - The value to set
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}

/**
 * Delete a nested value from an object using dot notation.
 *
 * @param obj - The object to modify (mutated in place)
 * @param path - Dot-separated path (e.g., "featureFlags.someFlag")
 * @returns true if the key existed and was deleted, false otherwise
 */
export function deleteNestedValue(obj: Record<string, unknown>, path: string): boolean {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
      return false;
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey in current) {
    delete current[lastKey];
    return true;
  }
  return false;
}

/**
 * Coerce a string value to its appropriate type.
 * - "true" / "false" -> boolean
 * - Numeric strings -> number
 * - Everything else -> string
 *
 * @param value - The string value to coerce
 * @param forceString - If true, always return the value as a string
 * @returns The coerced value
 */
export function coerceValue(value: string, forceString: boolean = false): string | number | boolean {
  if (forceString) {
    return value;
  }

  // Boolean coercion
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  // Number coercion - must be a valid finite number
  const num = Number(value);
  if (!isNaN(num) && isFinite(num) && value.trim() !== '') {
    return num;
  }

  return value;
}

/**
 * Format a value for YAML-like display.
 *
 * @param value - The value to format
 * @param indent - Current indentation level
 * @returns Formatted string
 */
export function formatValueYaml(value: unknown, indent: number = 0): string {
  const indentStr = '  '.repeat(indent);

  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value.map((item) => `${indentStr}- ${formatValueYaml(item, indent + 1)}`).join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    return entries
      .map(([key, val]) => {
        const formattedVal = formatValueYaml(val, indent + 1);
        if (typeof val === 'object' && val !== null && Object.keys(val).length > 0) {
          return `${indentStr}${key}:\n${formattedVal}`;
        }
        return `${indentStr}${key}: ${formattedVal}`;
      })
      .join('\n');
  }

  return String(value);
}

/**
 * Validate a configuration object against the schema.
 *
 * @param config - The configuration to validate
 * @returns Validation result with success status and optional error message
 */
export function validateConfig(config: unknown): { success: boolean; error?: string } {
  try {
    GlobalConfigSchema.parse(config);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      return { success: false, error: messages.join('; ') };
    }
    return { success: false, error: 'Unknown validation error' };
  }
}
