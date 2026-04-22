import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

describe('CommandAgentBackend stdin failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('turns broken stdin pipes into a handled backend error', async () => {
    vi.doMock('node:child_process', () => {
      class BrokenPipeWritable extends Writable {
        _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
          const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
          process.nextTick(() => this.emit('error', error));
          callback(error);
        }
      }

      const spawn = vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          stdin: Writable;
          kill: () => void;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new BrokenPipeWritable();
        child.kill = () => {};

        process.nextTick(() => {
          child.stderr.end('child exited before reading stdin');
          child.emit('close', 1);
        });

        return child;
      });

      return { spawn };
    });

    const { CommandAgentBackend } = await import('../../../src/core/runtime/agent-backends/backends/CommandAgentBackend.js');
    const backend = new CommandAgentBackend();

    await expect(
      backend.invoke(
        {
          mode: 'command',
          command: 'node',
          args: ['fake-runner.js'],
        },
        {
          agent_name: 'implementation_agent',
          backend_name: 'codex-cli',
          mode: 'command',
          workspace_root: process.cwd(),
          input_refs: [],
          constraints: {
            canReadJira: true,
            canEditSpecs: false,
            canEditCode: true,
            canRunValidation: false,
            canCommentJira: false,
            canArchive: false,
          },
          task_prompt: 'Apply implementation changes.',
        }
      )
    ).rejects.toThrow(/failed while sending input payload|exited with code 1/i);
  });
});
