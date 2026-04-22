import { spawn } from 'node:child_process';
import type { AgentBackend } from '../AgentBackend.js';
import type { AgentBackendConfig } from '../config.js';
import type { AgentInvocationRequest, AgentInvocationResult } from '../types.js';

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export class CommandAgentBackend implements AgentBackend {
  readonly mode = 'command' as const;

  async invoke(config: AgentBackendConfig, request: AgentInvocationRequest): Promise<AgentInvocationResult> {
    if (!config.command) {
      throw new Error(`Backend "${request.backend_name}" requires "command" for command mode.`);
    }

    const requestPayload = {
      backend_name: request.backend_name,
      agent_name: request.agent_name,
      workspace_root: request.workspace_root,
      change_name: request.change_name,
      backend_config: {
        sandbox_mode: config.sandbox_mode ?? null,
        implementation_mode: config.implementation_mode ?? null,
      },
      constraints: request.constraints,
      budget: request.budget ?? {},
      system_prompt: request.system_prompt ?? null,
      task_prompt: request.task_prompt,
      metadata: request.metadata ?? {},
    };

    const responsePayload = await new Promise<unknown>((resolve, reject) => {
      const child = spawn(config.command!, config.args ?? [], {
        cwd: request.workspace_root,
        env: {
          ...process.env,
          ...(config.env ?? {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeoutMs = config.timeout_ms ?? 300_000;
      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const succeed = (value: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        fail(new Error(`Backend "${request.backend_name}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        fail(error);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          fail(
            new Error(
              `Backend "${request.backend_name}" exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ''}`
            )
          );
          return;
        }
        succeed(parseMaybeJson(stdout.trim()));
      });
      child.stdin.on('error', (error) => {
        const details = error instanceof Error ? error.message : String(error);
        fail(new Error(`Backend "${request.backend_name}" failed while sending input payload. ${details}`));
      });

      try {
        child.stdin.end(JSON.stringify(requestPayload));
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        fail(new Error(`Backend "${request.backend_name}" failed while sending input payload. ${details}`));
      }
    });

    const structuredOutput =
      responsePayload && typeof responsePayload === 'object' && !Array.isArray(responsePayload)
        ? (responsePayload as Record<string, unknown>)
        : null;

    return {
      backend_name: request.backend_name,
      mode: this.mode,
      status: 'executed',
      system_prompt: request.system_prompt,
      task_prompt: request.task_prompt,
      request_payload: requestPayload,
      response_payload: responsePayload,
      structured_output: structuredOutput,
      notes: ['Command backend executed in the project workspace.'],
    };
  }
}
