import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import {
  archiveTimer,
  pause,
  purpose,
  report,
  resume,
  showImportedTicket,
  startManualHumanTimer,
  switchBlock,
  validateIssueKey,
} from '../../src/core/timer/commands.js';
import { getActiveSession, getSessionsDir, saveActiveSession } from '../../src/core/timer/store.js';
import { buildAssignedTicketsJql, listAssignedTickets } from '../../src/core/timer/tickets.js';
import { newChangeCommand } from '../../src/commands/workflow/new-change.js';
import { createTrackedOpsxChange, trackOpsxWorkflow } from '../../src/commands/workflow/opsx.js';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('OpenSpec Jira work timer', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-timer-test-')));
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

  it('validates Jira issue keys', () => {
    expect(() => validateIssueKey('PROJ-123')).not.toThrow();
    expect(() => validateIssueKey('proj-123')).toThrow('Invalid Jira issue key');
    expect(() => validateIssueKey('PROJ')).toThrow('Invalid Jira issue key');
  });

  it('explains when real Jira commands are run with placeholder demo config', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://tuempresa.atlassian.net',
        email: 'dev@tuempresa.com',
        api_token: 'TU_TOKEN',
      },
    });

    await expect(purpose('PROJ-123')).rejects.toThrow("For the local sandbox demo, run 'npm run demo:jira'");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts a Jira-backed timer session from purpose', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }));

    await purpose('PROJ-123');

    const session = await getActiveSession();
    expect(session).toMatchObject({
      jira_issue_key: 'PROJ-123',
      started_at: '2026-04-19T17:03:11.000Z',
      user_email: 'dev@example.com',
      status: 'running',
      command: 'purpose',
      cwd: tempDir,
      notes: null,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJ-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('dev@example.com:token').toString('base64')}`,
        }),
      })
    );
  });

  it('imports Jira ticket context into the timer session when requested', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement OpenSpec Jira tracking',
        status: {
          name: 'In Progress',
        },
        assignee: {
          displayName: 'Emiliano',
        },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Track local OpenSpec work sessions.',
                },
              ],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Create Jira worklogs on archive.',
                },
              ],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });

    const session = await getActiveSession();
    expect(session?.jira_ticket).toEqual({
      key: 'PROJ-123',
      summary: 'Implement OpenSpec Jira tracking',
      status: 'In Progress',
      assignee: 'Emiliano',
      description_text: 'Track local OpenSpec work sessions.\n\nCreate Jira worklogs on archive.',
      url: 'https://example.atlassian.net/browse/PROJ-123',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJ-123?fields=summary%2Cdescription%2Cstatus%2Cassignee',
      expect.objectContaining({
        method: 'GET',
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Imported Jira ticket context: PROJ-123 - Implement OpenSpec Jira tracking'
    );
  });

  it('shows imported Jira ticket context from the active session as JSON', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement OpenSpec Jira tracking',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Track local OpenSpec work sessions.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    consoleLogSpy.mockClear();

    await showImportedTicket({ json: true });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(payload).toMatchObject({
      found: true,
      reason: 'ok',
      jira_issue_key: 'PROJ-123',
      ticket: {
        key: 'PROJ-123',
        summary: 'Implement OpenSpec Jira tracking',
        status: 'In Progress',
        assignee: 'Emiliano',
        description_text: 'Track local OpenSpec work sessions.',
      },
    });
  });

  it('explains when the active session has no imported Jira ticket context', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }));

    await purpose('PROJ-123');
    consoleLogSpy.mockClear();

    await showImportedTicket();

    expect(consoleLogSpy).toHaveBeenNthCalledWith(
      1,
      'Active session for PROJ-123 has no imported Jira ticket context.'
    );
    expect(consoleLogSpy).toHaveBeenNthCalledWith(
      2,
      "Start the session with `osj purpose --jira PROJ-123 --import-ticket` to persist ticket content locally."
    );
  });

  it('lists assigned Jira tickets using default project JQL', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
      jira: {
        base_url: 'https://example.atlassian.net',
        email: 'dev@example.com',
        api_token: 'token',
        default_project: 'PROJ',
      },
    });
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      issues: [
        {
          key: 'PROJ-123',
          fields: {
            summary: 'Implement selectable ticket workflow',
            status: { name: 'In Progress' },
            assignee: { displayName: 'Emiliano' },
          },
        },
      ],
    }));

    const tickets = await listAssignedTickets({ limit: 5 });

    expect(tickets).toEqual([
      {
        key: 'PROJ-123',
        summary: 'Implement selectable ticket workflow',
        status: 'In Progress',
        assignee: 'Emiliano',
        url: 'https://example.atlassian.net/browse/PROJ-123',
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/search/jql',
      expect.objectContaining({
        method: 'POST',
      })
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      jql: 'project = "PROJ" AND assignee = currentUser() AND resolution IS EMPTY ORDER BY updated DESC',
      fields: ['summary', 'status', 'assignee'],
      maxResults: 5,
    });
  });

  it('builds custom ticket JQL without default project filters', () => {
    expect(buildAssignedTicketsJql({ allProjects: true })).toBe(
      'assignee = currentUser() AND resolution IS EMPTY ORDER BY updated DESC'
    );
    expect(buildAssignedTicketsJql({ customJql: 'status = "In Progress"' })).toBe('status = "In Progress"');
  });

  it('creates an OpenSpec change from the imported Jira ticket during purpose', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement OpenSpec Jira tracking',
        status: {
          name: 'To Do',
        },
        assignee: null,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Use the Jira ticket description as change context.',
                },
              ],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true, createChange: true });

    const session = await getActiveSession();
    expect(session?.openspec_change?.name).toBe('proj-123-implement-openspec-jira-tracking');

    const changeDir = path.join(tempDir, 'openspec', 'changes', 'proj-123-implement-openspec-jira-tracking');
    const proposal = await fs.readFile(path.join(changeDir, 'proposal.md'), 'utf-8');
    const spec = await fs.readFile(
      path.join(changeDir, 'specs', 'proj-123-implement-openspec-jira-tracking', 'spec.md'),
      'utf-8'
    );
    const ticket = await fs.readFile(path.join(changeDir, 'jira-ticket.md'), 'utf-8');

    expect(proposal).toContain('Imported from Jira issue [PROJ-123]');
    expect(spec).toContain('## ADDED Requirements');
    expect(spec).toContain('Use the Jira ticket description as change context.');
    expect(ticket).toContain('# PROJ-123 - Implement OpenSpec Jira tracking');
  });

  it('creates an OpenSpec change directly from a Jira ticket', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-456',
      fields: {
        summary: 'Add imported ticket workflow',
        status: {
          name: 'Selected for Development',
        },
        assignee: {
          displayName: 'Emiliano',
        },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Create OpenSpec artifacts from Jira.',
                },
              ],
            },
          ],
        },
      },
    }));

    await newChangeCommand(undefined, { fromTicket: 'PROJ-456' });

    const changeDir = path.join(tempDir, 'openspec', 'changes', 'proj-456-add-imported-ticket-workflow');
    const tasks = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf-8');
    const spec = await fs.readFile(
      path.join(changeDir, 'specs', 'proj-456-add-imported-ticket-workflow', 'spec.md'),
      'utf-8'
    );

    expect(tasks).toContain('Review imported Jira ticket context for `PROJ-456`');
    expect(spec).toContain('Create OpenSpec artifacts from Jira.');
  });

  it('creates an OpenSpec change from the active timer session ticket', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Implement from-session workflow',
        status: {
          name: 'In Progress',
        },
        assignee: {
          displayName: 'Emiliano',
        },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Create a change from the active timer session.',
                },
              ],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    await newChangeCommand(undefined, { fromSession: true });

    const changeDir = path.join(tempDir, 'openspec', 'changes', 'proj-123-implement-from-session-workflow');
    const proposal = await fs.readFile(path.join(changeDir, 'proposal.md'), 'utf-8');
    expect(proposal).toContain('Imported from Jira issue [PROJ-123]');

    const session = await getActiveSession();
    expect(session?.openspec_change).toMatchObject({
      name: 'proj-123-implement-from-session-workflow',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('tracks OPSX explore natively and exposes imported ticket context as JSON', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Explore imported Jira context',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Investigate the imported session context.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    consoleLogSpy.mockClear();

    const result = await trackOpsxWorkflow('explore', { json: true });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleLogSpy.mock.calls[0][0] as string)).toMatchObject({
      workflow: 'explore',
      phase: 'discovery',
      session: {
        found: true,
        jira_issue_key: 'PROJ-123',
        status: 'running',
        tracking_applied: true,
        target_block: {
          mode: 'human_agent_interaction',
          kind: 'spec',
        },
      },
      ticket: {
        key: 'PROJ-123',
        summary: 'Explore imported Jira context',
      },
    });
    expect(result.message).toContain('Tracked OPSX explore');

    const session = await getActiveSession();
    expect(session?.current_block).toMatchObject({
      actor_mode: 'human_agent_interaction',
      work_kind: 'spec',
      description: 'OPSX explore discovery and requirement clarification',
    });
  });

  it('creates a tracked OPSX change from a running session and restores collaborative propose tracking', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Create tracked OPSX change',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Create a tracked change from the active session.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    await createTrackedOpsxChange('proj-123-create-tracked-opsx-change');

    const session = await getActiveSession();
    expect(session?.openspec_change).toMatchObject({
      name: 'proj-123-create-tracked-opsx-change',
    });
    expect(session?.current_block).toMatchObject({
      actor_mode: 'human_agent_interaction',
      work_kind: 'spec',
      description: 'OPSX propose discovery and artifact drafting',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('creates a tracked OPSX change from a paused session and keeps the change attached to the runtime session', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-123',
      fields: {
        summary: 'Create tracked change from paused session',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Emiliano' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Allow attaching a change while paused.' }],
            },
          ],
        },
      },
    }));

    await purpose('PROJ-123', { importTicket: true });
    await pause();
    await createTrackedOpsxChange('proj-123-create-tracked-change-while-paused');

    const session = await getActiveSession();
    expect(session?.status).toBe('paused');
    expect(session?.openspec_change).toMatchObject({
      name: 'proj-123-create-tracked-change-while-paused',
    });
  });

  it('turns structured Jira SDD sections into a richer OpenSpec delta spec', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      key: 'PROJ-789',
      fields: {
        summary: 'Carga de información general del Director Técnico',
        status: {
          name: 'Draft',
        },
        assignee: null,
        description: `Como Director Técnico
Quiero cargar mi información general
Para completar mi perfil y poder crear un equipo.

SDD SPEC

# SPEC: Carga y persistencia de información general del perfil del Director Técnico

## Context

El Director Técnico necesita completar la información general mínima de su perfil.

## Goals

Permitir al Director Técnico ingresar y guardar su información general de perfil.

## Acceptance Criteria

### CA-1 — Visualización de campos mínimos requeridos

**GIVEN** que el Director Técnico ha iniciado sesión

**WHEN** el sistema carga la sección de información general del perfil

**THEN** debe permitir ingresar como mínimo los campos \`nombre\` y \`apellido\`.

### CA-2 — Guardado exitoso con datos mínimos válidos

**GIVEN** que ingresa un \`nombre\` válido

**AND** ingresa un \`apellido\` válido

**WHEN** presiona \`Guardar\`

**THEN** el sistema guarda la información general del perfil.

## Business Rules

**BR-1. Campos mínimos obligatorios:** la información general mínima requerida está compuesta por \`nombre\` y \`apellido\`.

## Domain / Data / Integration Contracts

| Campo | Tipo lógico | Requerido | Regla |
|---|---|---:|---|
| nombre | texto | Sí | No puede ser vacío |
| apellido | texto | Sí | No puede ser vacío |
`,
      },
    }));

    await newChangeCommand(undefined, { fromTicket: 'PROJ-789' });

    const changeDir = path.join(tempDir, 'openspec', 'changes', 'proj-789-carga-de-informacion-general-del-director-tecnico');
    const spec = await fs.readFile(
      path.join(changeDir, 'specs', 'proj-789-carga-de-informacion-general-del-director-tecnico', 'spec.md'),
      'utf-8'
    );
    const tasks = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf-8');

    expect(spec).toContain('### Requirement: Carga y persistencia de información general del perfil del Director Técnico');
    expect(spec).toContain('Imported business rules:');
    expect(spec).toContain('Imported domain/data/integration contracts:');
    expect(spec).toContain('#### Scenario: CA-1 - Visualización de campos mínimos requeridos');
    expect(spec).toContain('- **GIVEN** que el Director Técnico ha iniciado sesión');
    expect(spec).toContain('#### Scenario: CA-2 - Guardado exitoso con datos mínimos válidos');
    expect(spec).not.toContain('Imported Jira description:');
    expect(tasks).toContain('Implement and verify CA-1: Visualización de campos mínimos requeridos');
    expect(tasks).toContain('Implement and verify CA-2: Guardado exitoso con datos mínimos válidos');
  });

  it('archives a timer session by creating a Jira worklog and saving local metadata', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:03:11.000Z'));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }))
      .mockResolvedValueOnce(jsonResponse({ id: '123456' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'comment-1' }, { status: 201 }));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-19T18:28:47.000Z'));
    await archiveTimer({ comment: 'OpenSpec implementation session' });

    expect(await getActiveSession()).toBeNull();

    const postCall = fetchSpy.mock.calls[1];
    expect(postCall[0]).toBe('https://example.atlassian.net/rest/api/3/issue/PROJ-123/worklog');
    const payload = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(payload.timeSpentSeconds).toBe(5160);
    expect(JSON.stringify(payload.comment)).toContain('OpenSpec: Human work');
    expect(JSON.stringify(payload.comment)).toContain('Kind: implementation');
    expect(JSON.stringify(payload.comment)).toContain('Archive comment: OpenSpec implementation session');
    expect(payload.started).toMatch(/^2026-04-19T\d{2}:03:11\.000[+-]\d{4}$/);

    const commentCall = fetchSpy.mock.calls[2];
    expect(commentCall[0]).toBe('https://example.atlassian.net/rest/api/3/issue/PROJ-123/comment');
    const commentPayload = JSON.parse((commentCall[1] as RequestInit).body as string);
    expect(JSON.stringify(commentPayload)).toContain('OpenSpec archive completed.');
    expect(JSON.stringify(commentPayload)).toContain('Jira worklogs: 123456');

    const sessions = await fs.readdir(getSessionsDir());
    expect(sessions).toHaveLength(1);
    const archived = JSON.parse(
      await fs.readFile(path.join(getSessionsDir(), sessions[0]), 'utf-8')
    );
    expect(archived).toMatchObject({
      jira_issue_key: 'PROJ-123',
      raw_duration_seconds: 5136,
      rounded_duration_seconds: 5160,
      worklog_status: 'synced',
      jira_worklog_id: '123456',
      jira_worklogs: [
        expect.objectContaining({
          actor_mode: 'human',
          work_kind: 'implementation',
          rounded_duration_seconds: 5160,
          jira_worklog_id: '123456',
        }),
      ],
      comment: 'OpenSpec implementation session',
      status: 'closed',
    });
  });

  it('creates separate Jira worklogs for granular switched timer blocks', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:00:00.000Z'));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'human-1' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ai-1' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'interaction-1' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'comment-1' }, { status: 201 }));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-19T17:10:00.000Z'));
    await switchBlock({
      mode: 'ai_autonomous',
      kind: 'spec',
      description: 'Agent generated OpenSpec deltas',
    });

    vi.setSystemTime(new Date('2026-04-19T17:25:00.000Z'));
    await switchBlock({
      mode: 'human_agent_interaction',
      kind: 'review',
      description: 'Developer reviewed agent output',
    });

    vi.setSystemTime(new Date('2026-04-19T17:40:00.000Z'));
    await archiveTimer({ comment: 'Granular session' });

    const worklogPayloads = fetchSpy.mock.calls
      .filter((call) => String(call[0]).endsWith('/worklog'))
      .map((call) => JSON.parse((call[1] as RequestInit).body as string));

    expect(worklogPayloads).toHaveLength(3);
    expect(worklogPayloads.map((payload) => payload.timeSpentSeconds)).toEqual([600, 900, 900]);
    expect(JSON.stringify(worklogPayloads[0].comment)).toContain('OpenSpec: Human work');
    expect(JSON.stringify(worklogPayloads[1].comment)).toContain('OpenSpec: AI autonomous work');
    expect(JSON.stringify(worklogPayloads[1].comment)).toContain('Agent generated OpenSpec deltas');
    expect(JSON.stringify(worklogPayloads[2].comment)).toContain('OpenSpec: Human-agent interaction');

    const sessions = await fs.readdir(getSessionsDir());
    const archived = JSON.parse(
      await fs.readFile(path.join(getSessionsDir(), sessions[0]), 'utf-8')
    );
    expect(archived.jira_worklogs).toEqual([
      expect.objectContaining({
        actor_mode: 'human',
        work_kind: 'implementation',
        jira_worklog_id: 'human-1',
      }),
      expect.objectContaining({
        actor_mode: 'ai_autonomous',
        work_kind: 'spec',
        jira_worklog_id: 'ai-1',
      }),
      expect.objectContaining({
        actor_mode: 'human_agent_interaction',
        work_kind: 'review',
        jira_worklog_id: 'interaction-1',
      }),
    ]);
  });

  it('reports Jira worklogs that would be created without syncing them', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:00:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-19T17:10:00.000Z'));
    await switchBlock({
      mode: 'ai_autonomous',
      kind: 'spec',
      description: 'Agent drafted the spec',
    });

    vi.setSystemTime(new Date('2026-04-19T17:25:00.000Z'));
    await report({ dryRun: true, changeName: 'proj-123-demo-change' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('OpenSpec archive dry run');
    expect(output).toContain('No Jira worklogs or comments will be created.');
    expect(output).toContain('Change: proj-123-demo-change');
    expect(output).toContain('Jira worklogs to create:');
    expect(output).toContain('1. Human work / implementation');
    expect(output).toContain('2. AI autonomous work / spec');
    expect(output).toContain('Description: Agent drafted the spec');
  });

  it('starts a manual human bugfix timer outside the purpose/archive lifecycle', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:00:00.000Z'));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'manual-bugfix-1' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'comment-1' }, { status: 201 }));

    await startManualHumanTimer('PROJ-123', {
      kind: 'bugfix',
      description: 'Fix production validation issue',
    });

    const active = await getActiveSession();
    expect(active).toMatchObject({
      jira_issue_key: 'PROJ-123',
      command: 'timer_start',
      current_block: expect.objectContaining({
        actor_mode: 'human',
        work_kind: 'bugfix',
        description: 'Fix production validation issue',
        source: 'manual',
      }),
    });

    vi.setSystemTime(new Date('2026-04-19T17:12:00.000Z'));
    await archiveTimer({ comment: 'Manual bugfix after archive' });

    const payload = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(payload.timeSpentSeconds).toBe(720);
    expect(JSON.stringify(payload.comment)).toContain('OpenSpec: Human work');
    expect(JSON.stringify(payload.comment)).toContain('Kind: bugfix');
    expect(JSON.stringify(payload.comment)).toContain('Fix production validation issue');

    const sessions = await fs.readdir(getSessionsDir());
    const archived = JSON.parse(
      await fs.readFile(path.join(getSessionsDir(), sessions[0]), 'utf-8')
    );
    expect(archived.jira_worklogs).toEqual([
      expect.objectContaining({
        actor_mode: 'human',
        work_kind: 'bugfix',
        jira_worklog_id: 'manual-bugfix-1',
      }),
    ]);
  });

  it('pauses and resumes a timer session, excluding paused time from the worklog', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:00:00.000Z'));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'paused-worklog' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'comment-1' }, { status: 201 }));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-19T17:30:00.000Z'));
    await pause();

    let session = await getActiveSession();
    expect(session).toMatchObject({
      status: 'paused',
      paused_at: '2026-04-19T17:30:00.000Z',
      paused_duration_seconds: 0,
    });

    vi.setSystemTime(new Date('2026-04-19T18:30:00.000Z'));
    await resume();

    session = await getActiveSession();
    expect(session).toMatchObject({
      status: 'running',
      paused_duration_seconds: 3600,
    });
    expect(session?.pause_events?.[0]).toMatchObject({
      paused_at: '2026-04-19T17:30:00.000Z',
      resumed_at: '2026-04-19T18:30:00.000Z',
      duration_seconds: 3600,
    });

    vi.setSystemTime(new Date('2026-04-19T19:00:00.000Z'));
    await archiveTimer({ comment: 'Session with lunch break' });

    const payload = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(payload.timeSpentSeconds).toBe(3600);

    const sessions = await fs.readdir(getSessionsDir());
    const archived = JSON.parse(
      await fs.readFile(path.join(getSessionsDir(), sessions[0]), 'utf-8')
    );
    expect(archived).toMatchObject({
      raw_duration_seconds: 3600,
      rounded_duration_seconds: 3600,
      paused_duration_seconds: 3600,
      jira_worklog_id: 'paused-worklog',
    });
  });

  it('archives a paused timer without counting time after the pause', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:00:00.000Z'));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'paused-close' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'comment-1' }, { status: 201 }));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-19T17:45:00.000Z'));
    await pause();

    vi.setSystemTime(new Date('2026-04-20T13:00:00.000Z'));
    await archiveTimer({ comment: 'Closed next day while paused' });

    const payload = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(payload.timeSpentSeconds).toBe(2700);

    const sessions = await fs.readdir(getSessionsDir());
    const archived = JSON.parse(
      await fs.readFile(path.join(getSessionsDir(), sessions[0]), 'utf-8')
    );
    expect(archived).toMatchObject({
      raw_duration_seconds: 2700,
      rounded_duration_seconds: 2700,
      status: 'closed',
      jira_worklog_id: 'paused-close',
    });
    expect(archived.paused_duration_seconds).toBeGreaterThan(0);
  });

  it('keeps failed archive attempts as sync_pending and retries without extending duration even without explicit retry flag', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:00:00.000Z'));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }))
      .mockRejectedValueOnce(new Error('Connection timeout'));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-19T17:00:17.000Z'));
    await expect(archiveTimer()).rejects.toThrow('sync_pending');

    const pending = await getActiveSession();
    expect(pending).toMatchObject({
      status: 'sync_pending',
      worklog_status: 'pending',
      raw_duration_seconds: 17,
      rounded_duration_seconds: 60,
      sync_error: 'Connection timeout',
    });

    vi.setSystemTime(new Date('2026-04-19T19:00:00.000Z'));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 'retry-1' }, { status: 201 }));

    await archiveTimer();

    expect(await getActiveSession()).toBeNull();
    const retryPayload = JSON.parse((fetchSpy.mock.calls[2][1] as RequestInit).body as string);
    expect(retryPayload.timeSpentSeconds).toBe(60);
  });

  it('recovers a stale sync_pending timer session when runtime already closed successfully', async () => {
    vi.setSystemTime(new Date('2026-04-19T17:00:00.000Z'));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-123' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'worklog-1' }, { status: 201 }));

    await purpose('PROJ-123');

    vi.setSystemTime(new Date('2026-04-19T17:00:17.000Z'));
    const closedSession = await archiveTimer({ comment: 'Recovered later', addJiraArchiveComment: false });

    await saveActiveSession({
      ...closedSession,
      status: 'sync_pending',
      worklog_status: 'pending',
      sync_error: 'stale local state',
    });

    const recovered = await archiveTimer();

    expect(recovered).toMatchObject({
      status: 'closed',
      worklog_status: 'synced',
      jira_issue_key: 'PROJ-123',
    });
    expect(await getActiveSession()).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith('Recovered previously synced OpenSpec session for PROJ-123');
  });
});
