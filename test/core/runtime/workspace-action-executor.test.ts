import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  WorkspaceActionExecutor,
  parseWorkspaceActions,
} from '../../../src/agents/implementation/WorkspaceActionExecutor.js';

describe('WorkspaceActionExecutor', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-workspace-actions-test-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'feature.mjs'), 'export const flag = false;\n', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('parses valid workspace actions from structured output', () => {
    const actions = parseWorkspaceActions([
      { type: 'write_file', path: 'test/example.mjs', content: 'export {};\n' },
      { type: 'replace_in_file', path: 'src/feature.mjs', old: 'false', new: 'true' },
      { type: 'run_command', command: ['node', '--test', 'test/example.mjs'] },
    ]);

    expect(actions).toHaveLength(3);
  });

  it('applies file edits and focused test commands locally', async () => {
    const executor = new WorkspaceActionExecutor({
      projectRoot: tempDir,
      changeName: 'demo-change',
    });

    const summary = await executor.execute([
      {
        type: 'replace_in_file',
        path: 'src/feature.mjs',
        old: 'export const flag = false;\n',
        new: 'export const flag = true;\n',
      },
      {
        type: 'write_file',
        path: 'test/feature.test.mjs',
        content: [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { flag } from '../src/feature.mjs';",
          "test('flag becomes true', () => {",
          '  assert.equal(flag, true);',
          '});',
          '',
        ].join('\n'),
      },
      {
        type: 'run_command',
        command: ['node', '--test', 'test/feature.test.mjs'],
        reason: 'Run focused feature test',
      },
    ]);

    expect(summary.status).toBe('APPLIED');
    expect(summary.applied_actions).toBe(3);
    expect(summary.touched_files).toEqual(expect.arrayContaining(['src/feature.mjs', 'test/feature.test.mjs']));
    expect(summary.command_results[0]?.exit_code).toBe(0);
    expect(await fs.readFile(path.join(tempDir, 'src', 'feature.mjs'), 'utf-8')).toContain('true');
  });

  it('blocks writes inside runtime artifacts and blocked command prefixes', async () => {
    const executor = new WorkspaceActionExecutor({
      projectRoot: tempDir,
      changeName: 'demo-change',
    });

    const summary = await executor.execute([
      {
        type: 'write_file',
        path: '.openspec/runtime/forbidden.json',
        content: '{}\n',
      },
      {
        type: 'run_command',
        command: ['rm', '-rf', '/tmp/demo'],
      },
    ]);

    expect(summary.status).toBe('FAILED');
    expect(summary.applied_actions).toBe(0);
    expect(summary.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('.openspec/runtime'),
      expect.stringContaining('Blocked command'),
    ]));
  });
});
