import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { resolveArchiveRouting } from '../../src/cli/archive-routing.js';
import type { TimerSession } from '../../src/core/timer/types.js';

function buildTimerSession(projectRoot: string, changeName?: string): TimerSession {
  return {
    session_id: 'sess-1',
    jira_issue_key: 'PROJ-123',
    started_at: '2026-04-22T18:00:00.000Z',
    started_at_local: '2026-04-22T15:00:00-03:00',
    user_email: 'dev@example.com',
    status: 'running',
    command: 'purpose',
    cwd: projectRoot,
    notes: null,
    openspec_change: changeName
      ? {
          name: changeName,
          path: path.join(projectRoot, 'openspec', 'changes', changeName),
          schema: 'spec-driven',
        }
      : undefined,
  };
}

describe('resolveArchiveRouting', () => {
  it('falls back to timer archive when the active session has no associated change', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-archive-routing-'));
    try {
      const decision = await resolveArchiveRouting({
        projectRoot: tempDir,
        timerSession: buildTimerSession(tempDir),
      });

      expect(decision).toEqual({
        targetChangeName: undefined,
        fallBackToTimerArchive: true,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to timer archive when the session references a missing change', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-archive-routing-'));
    try {
      const decision = await resolveArchiveRouting({
        projectRoot: tempDir,
        timerSession: buildTimerSession(tempDir, 'missing-change'),
      });

      expect(decision.fallBackToTimerArchive).toBe(true);
      expect(decision.targetChangeName).toBeUndefined();
      expect(decision.warning).toContain("missing change 'missing-change'");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps the target change when the inferred change exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-archive-routing-'));
    try {
      const changeName = 'runtime-explain';
      await fs.mkdir(path.join(tempDir, 'openspec', 'changes', changeName), { recursive: true });

      const decision = await resolveArchiveRouting({
        projectRoot: tempDir,
        timerSession: buildTimerSession(tempDir, changeName),
      });

      expect(decision).toEqual({
        targetChangeName: changeName,
        fallBackToTimerArchive: false,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not override an explicit change name', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-archive-routing-'));
    try {
      const decision = await resolveArchiveRouting({
        projectRoot: tempDir,
        explicitChangeName: 'manual-change',
        timerSession: buildTimerSession(tempDir, 'missing-change'),
      });

      expect(decision).toEqual({
        targetChangeName: 'manual-change',
        fallBackToTimerArchive: false,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
