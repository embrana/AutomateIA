import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { saveGlobalConfig } from '../../../src/core/global-config.js';
import { purpose } from '../../../src/core/timer/commands.js';
import { RuntimeStatusCommand } from '../../../src/core/runtime/status.js';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('RuntimeStatusCommand', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-runtime-status-test-')));
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    process.chdir(tempDir);
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config-home');

    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://example.atlassian.net',
        email: 'dev@example.com',
        api_token: 'token',
      },
      worklog: {
        rounding: 'minute',
        min_seconds: 60,
        comment_template: 'OpenSpec execution session',
        track_metadata_locally: true,
      },
    });

    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.chdir(originalCwd);
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('renders the current runtime snapshot as JSON', async () => {
    vi.setSystemTime(new Date('2026-04-21T14:10:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement runtime status command',
        status: { name: 'In Progress' },
        assignee: null,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Expose runtime state from the CLI.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    consoleLogSpy.mockClear();

    const command = new RuntimeStatusCommand();
    await command.execute({ json: true });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(payload.ticket.ticket_key).toBe('PROJ-123');
    expect(payload.ticket.state).toBe('CONTEXT_IMPORTED');
    expect(payload.session.state).toBe('ACTIVE');
    expect(payload.source).toBe('active_timer');
  });
});
