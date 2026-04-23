import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createChangeFromTicket, parseStructuredSdd } from '../../src/core/timer/ticket-change.js';
import type { ImportedJiraTicket } from '../../src/core/timer/types.js';

describe('ticket-change structured SDD import', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-ticket-change-test-')));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('parses canonical english structured SDD headings', () => {
    const structured = parseStructuredSdd(`# SPEC: Runtime explain

## Context
Diagnose blocked runtime states quickly.

## Goals
- Show blockers
- Show the next command

## Acceptance Criteria
### CA-1 - Human-readable summary
- **GIVEN** an active runtime
- **WHEN** the command runs
- **THEN** the summary is printed

## Business Rules
- The command is read-only.
`, 'Fallback title');

    expect(structured).not.toBeNull();
    expect(structured?.title).toBe('Runtime explain');
    expect(structured?.context).toBe('Diagnose blocked runtime states quickly.');
    expect(structured?.goals).toContain('Show blockers');
    expect(structured?.acceptanceCriteria).toHaveLength(1);
    expect(structured?.acceptanceCriteria[0]).toMatchObject({
      id: 'CA-1',
      title: 'Human-readable summary',
    });
    expect(structured?.businessRules).toContain('read-only');
  });

  it('parses spanish headings and colon-separated acceptance criteria', () => {
    const structured = parseStructuredSdd(`# ESPEC: Runtime explain

## Contexto
Diagnosticar bloqueos del runtime sin abrir artifacts manualmente.

## Objetivos
- Explicar el estado actual
- Sugerir el siguiente comando

## No objetivos
- Ejecutar agentes automáticamente

## Criterios de aceptación
### CA-1: Explicación legible
- **GIVEN** una sesión activa
- **WHEN** el usuario ejecuta el comando
- **THEN** el sistema resume ticket, ciclo y bloqueos

### CA-2: Salida JSON
- **GIVEN** la opción --json
- **WHEN** el usuario ejecuta el comando
- **THEN** el sistema devuelve un objeto serializable

## Reglas de negocio
- El comando es solo lectura.

## Contratos de dominio / datos / integraciones
- Runtime snapshot
- Approval refs

## Estados de UX / Error
- Si no existe runtime, responder amigablemente.

## Fuera de alcance
- Resolver approvals automáticamente.

## Trazabilidad
- CA-1: CLI runtime
- CA-2: serialización JSON
`, 'Fallback title');

    expect(structured).not.toBeNull();
    expect(structured?.title).toBe('Runtime explain');
    expect(structured?.context).toContain('bloqueos del runtime');
    expect(structured?.goals).toContain('Explicar el estado actual');
    expect(structured?.nonGoals).toContain('Ejecutar agentes automáticamente');
    expect(structured?.acceptanceCriteria).toHaveLength(2);
    expect(structured?.acceptanceCriteria[0]).toMatchObject({
      id: 'CA-1',
      title: 'Explicación legible',
    });
    expect(structured?.acceptanceCriteria[1]).toMatchObject({
      id: 'CA-2',
      title: 'Salida JSON',
    });
    expect(structured?.businessRules).toContain('solo lectura');
    expect(structured?.domainContracts).toContain('Runtime snapshot');
    expect(structured?.uxErrorStates).toContain('responder amigablemente');
    expect(structured?.outOfScope).toContain('Resolver approvals automáticamente');
    expect(structured?.traceability).toContain('CA-1: CLI runtime');
  });

  it('creates richer change artifacts from a spanish structured ticket', async () => {
    const ticket: ImportedJiraTicket = {
      key: 'REB-231',
      summary: 'Agregar comando runtime explain',
      status: 'Backlog',
      assignee: 'Emiliano',
      url: 'https://example.atlassian.net/browse/REB-231',
      description_text: `# ESPEC: Runtime explain

## Contexto
Necesitamos explicar bloqueos del runtime con contexto accionable.

## Objetivos
- Mostrar snapshot resumido
- Mostrar approvals pendientes

## Criterios de aceptación
### CA-1: Explicación humana
- **GIVEN** un runtime existente
- **WHEN** se ejecuta el comando
- **THEN** el sistema muestra estado, bloqueos y próximo paso

### CA-2: JSON estructurado
- **GIVEN** la opción --json
- **WHEN** se ejecuta el comando
- **THEN** el sistema devuelve snapshot, blockers y artifact refs

## Reglas de negocio
- El comando no modifica estado.
`,
    };

    const result = await createChangeFromTicket(ticket, { name: 'reb-231-runtime-explain-spanish' });
    const tasks = await fs.readFile(path.join(result.path, 'tasks.md'), 'utf-8');
    const spec = await fs.readFile(path.join(result.path, 'specs', result.name, 'spec.md'), 'utf-8');

    expect(tasks).toContain('2.1 Implement and verify CA-1: Explicación humana');
    expect(tasks).toContain('2.2 Implement and verify CA-2: JSON estructurado');
    expect(spec).toContain('Imported goals:');
    expect(spec).toContain('Imported business rules:');
    expect(spec).toContain('#### Scenario: CA-1 - Explicación humana');
    expect(spec).toContain('#### Scenario: CA-2 - JSON estructurado');
  });
});
