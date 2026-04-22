import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { saveGlobalConfig } from '../../../src/core/global-config.js';
import { AgentBackendRegistry } from '../../../src/core/runtime/agent-backends/BackendRegistry.js';
import { OpenAICompatibleAgentBackend } from '../../../src/core/runtime/agent-backends/backends/OpenAICompatibleAgentBackend.js';
import { CommandAgentBackend } from '../../../src/core/runtime/agent-backends/backends/CommandAgentBackend.js';
import { AnthropicNativeAgentBackend } from '../../../src/core/runtime/agent-backends/backends/AnthropicNativeAgentBackend.js';
import {
  GeminiNativeAgentBackend,
  resolveGeminiVertexAccessToken,
} from '../../../src/core/runtime/agent-backends/backends/GeminiNativeAgentBackend.js';

describe('agent backends', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-agent-backends-test-'));
    originalEnv = { ...process.env };
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config-home');
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('resolves routed backends from global config', () => {
    saveGlobalConfig({
      agents: {
        default_backend: 'shared',
        routing: {
          implementation: 'codex-gateway',
        },
        backends: {
          shared: { mode: 'manual' },
          'codex-gateway': { mode: 'openai_compatible', base_url: 'https://example.com' },
        },
      },
    });

    const registry = new AgentBackendRegistry();
    expect(registry.resolveForAgent('implementation_agent')).toMatchObject({
      name: 'codex-gateway',
      config: { mode: 'openai_compatible', base_url: 'https://example.com' },
    });
    expect(registry.resolveForAgent('critic_agent')).toMatchObject({
      name: 'shared',
      config: { mode: 'manual' },
    });
  });

  it('executes openai-compatible backends with api_key_env auth', async () => {
    process.env.TEST_BACKEND_API_KEY = 'secret-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: 'applied',
                  limitations: [],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const backend = new OpenAICompatibleAgentBackend();
    const result = await backend.invoke(
      {
        mode: 'openai_compatible',
        base_url: 'https://example.com',
        api_key_env: 'TEST_BACKEND_API_KEY',
        model: 'gpt-test',
      },
      {
        agent_name: 'implementation_agent',
        backend_name: 'shared',
        mode: 'openai_compatible',
        workspace_root: tempDir,
        input_refs: [],
        constraints: {
          canReadJira: true,
          canEditSpecs: false,
          canEditCode: true,
          canRunValidation: false,
          canCommentJira: false,
          canArchive: false,
        },
        task_prompt: 'Return JSON only.',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key',
        }),
      })
    );
    expect(result.structured_output).toEqual({
      status: 'applied',
      limitations: [],
    });
  });

  it('executes command backends inside the workspace', async () => {
    const backend = new CommandAgentBackend();
    const result = await backend.invoke(
      {
        mode: 'command',
        command: process.execPath,
        args: [
          '-e',
          [
            'let input="";',
            'process.stdin.on("data", chunk => input += chunk);',
            'process.stdin.on("end", () => {',
            '  const parsed = JSON.parse(input);',
            '  process.stdout.write(JSON.stringify({',
            '    status: "applied",',
            '    files_touched: parsed.metadata.likely_affected_files || []',
            '  }));',
            '});',
          ].join(' '),
        ],
      },
      {
        agent_name: 'implementation_agent',
        backend_name: 'local-runner',
        mode: 'command',
        workspace_root: tempDir,
        input_refs: [],
        constraints: {
          canReadJira: true,
          canEditSpecs: false,
          canEditCode: true,
          canRunValidation: false,
          canCommentJira: false,
          canArchive: false,
        },
        task_prompt: 'Apply the implementation.',
        metadata: {
          likely_affected_files: ['src/core/archive.ts'],
        },
      }
    );

    expect(result.structured_output).toEqual({
      status: 'applied',
      files_touched: ['src/core/archive.ts'],
    });
  });

  it('executes anthropic-native backends with Messages API auth', async () => {
    process.env.ANTHROPIC_NATIVE_TEST_KEY = 'anthropic-secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_123',
          type: 'message',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'applied',
                limitations: [],
              }),
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const backend = new AnthropicNativeAgentBackend();
    const result = await backend.invoke(
      {
        mode: 'anthropic_native',
        model: 'claude-sonnet-test',
        api_key_env: 'ANTHROPIC_NATIVE_TEST_KEY',
      },
      {
        agent_name: 'implementation_agent',
        backend_name: 'claude-native',
        mode: 'anthropic_native',
        workspace_root: tempDir,
        input_refs: [],
        constraints: {
          canReadJira: true,
          canEditSpecs: false,
          canEditCode: true,
          canRunValidation: false,
          canCommentJira: false,
          canArchive: false,
        },
        system_prompt: 'System',
        task_prompt: 'Task',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'anthropic-secret',
          'anthropic-version': '2023-06-01',
        }),
      })
    );
    expect(result.structured_output).toEqual({
      status: 'applied',
      limitations: [],
    });
  });

  it('executes gemini-native developer api backends with x-goog-api-key auth', async () => {
    process.env.GEMINI_API_KEY_TEST = 'gemini-secret';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      status: 'applied',
                      limitations: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const backend = new GeminiNativeAgentBackend();
    const result = await backend.invoke(
      {
        mode: 'gemini_native',
        model: 'gemini-2.5-flash',
        api_key_env: 'GEMINI_API_KEY_TEST',
      },
      {
        agent_name: 'implementation_agent',
        backend_name: 'gemini-dev',
        mode: 'gemini_native',
        workspace_root: tempDir,
        input_refs: [],
        constraints: {
          canReadJira: true,
          canEditSpecs: false,
          canEditCode: true,
          canRunValidation: false,
          canCommentJira: false,
          canArchive: false,
        },
        task_prompt: 'Task',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-goog-api-key': 'gemini-secret',
        }),
      })
    );
    expect(result.structured_output).toEqual({
      status: 'applied',
      limitations: [],
    });
  });

  it('executes gemini-native vertex backends with bearer auth', async () => {
    process.env.GEMINI_VERTEX_TOKEN_TEST = 'vertex-token';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      status: 'applied',
                      limitations: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const backend = new GeminiNativeAgentBackend();
    const result = await backend.invoke(
      {
        mode: 'gemini_native',
        gemini_transport: 'vertex',
        model: 'gemini-2.5-pro',
        project: 'demo-project',
        location: 'us-central1',
        access_token_env: 'GEMINI_VERTEX_TOKEN_TEST',
      },
      {
        agent_name: 'implementation_agent',
        backend_name: 'gemini-vertex',
        mode: 'gemini_native',
        workspace_root: tempDir,
        input_refs: [],
        constraints: {
          canReadJira: true,
          canEditSpecs: false,
          canEditCode: true,
          canRunValidation: false,
          canCommentJira: false,
          canArchive: false,
        },
        task_prompt: 'Task',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer vertex-token',
        }),
      })
    );
    expect(result.structured_output).toEqual({
      status: 'applied',
      limitations: [],
    });
  });

  it('resolves gemini vertex token from GOOGLE_OAUTH_ACCESS_TOKEN in auto mode', async () => {
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = 'ambient-token';

    const resolved = await resolveGeminiVertexAccessToken({
      mode: 'gemini_native',
      gemini_transport: 'vertex',
      project: 'demo-project',
      location: 'global',
    });

    expect(resolved).toEqual({
      token: 'ambient-token',
      source: 'env',
    });
  });

  it('resolves gemini vertex token from gcloud adc when auto mode has no direct token', async () => {
    const resolved = await resolveGeminiVertexAccessToken(
      {
        mode: 'gemini_native',
        gemini_transport: 'vertex',
        project: 'demo-project',
        location: 'global',
      },
      vi.fn(async (_file: string, args?: readonly string[] | null) => {
        if (args?.join(' ') === 'auth application-default print-access-token') {
          return {
            stdout: 'adc-token\n',
            stderr: '',
          };
        }
        throw new Error('unexpected command');
      }) as any
    );

    expect(resolved).toEqual({
      token: 'adc-token',
      source: 'gcloud_adc',
    });
  });

  it('falls back to gcloud cli token when adc is unavailable', async () => {
    const resolved = await resolveGeminiVertexAccessToken(
      {
        mode: 'gemini_native',
        gemini_transport: 'vertex',
        project: 'demo-project',
        location: 'global',
      },
      vi.fn(async (_file: string, args?: readonly string[] | null) => {
        if (args?.join(' ') === 'auth application-default print-access-token') {
          throw new Error('adc unavailable');
        }
        if (args?.join(' ') === 'auth print-access-token') {
          return {
            stdout: 'cli-token\n',
            stderr: '',
          };
        }
        throw new Error('unexpected command');
      }) as any
    );

    expect(resolved).toEqual({
      token: 'cli-token',
      source: 'gcloud_cli',
    });
  });
});
