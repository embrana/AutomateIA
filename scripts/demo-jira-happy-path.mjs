#!/usr/bin/env node

import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'openspec.js');
const outputRoot = path.join(repoRoot, 'demo-output', 'jira-happy-path');
const projectDir = path.join(outputRoot, 'product-repo');
const configHome = path.join(outputRoot, 'config-home');
const worklogsPath = path.join(outputRoot, 'mock-jira-worklogs.json');
const commentsPath = path.join(outputRoot, 'mock-jira-comments.json');
const summaryPath = path.join(outputRoot, 'README.md');

const ticketDescription = `Como Director Tecnico
Quiero cargar mi informacion general
Para completar mi perfil y poder crear un equipo.

SDD SPEC

# SPEC: Carga y persistencia de informacion general del perfil del Director Tecnico

## Context

El Director Tecnico necesita completar la informacion general minima de su perfil.

## Goals

Permitir al Director Tecnico ingresar y guardar su informacion general de perfil.

## Acceptance Criteria

### CA-1 - Visualizacion de campos minimos requeridos

**GIVEN** que el Director Tecnico ha iniciado sesion

**WHEN** el sistema carga la seccion de informacion general del perfil

**THEN** debe permitir ingresar como minimo los campos \`nombre\` y \`apellido\`.

### CA-2 - Guardado exitoso con datos minimos validos

**GIVEN** que el Director Tecnico ingresa un \`nombre\` valido

**AND** ingresa un \`apellido\` valido

**WHEN** presiona \`Guardar\`

**THEN** el sistema guarda la informacion general del perfil

**AND** muestra una confirmacion visual de exito.

## Business Rules

**BR-1. Campos minimos obligatorios:** la informacion general minima requerida esta compuesta por \`nombre\` y \`apellido\`.

**BR-2. Normalizacion minima:** valores compuestos solo por espacios se consideran vacios.

## Domain / Data / Integration Contracts

| Campo | Tipo logico | Requerido | Regla |
|---|---|---:|---|
| nombre | texto | Si | No puede ser vacio ni solo espacios |
| apellido | texto | Si | No puede ser vacio ni solo espacios |

## UX / Error States

Al guardar correctamente, el usuario debe ver una confirmacion visual de exito.
Cuando falte un campo obligatorio, debe mostrarse un resumen general de validacion.

## Out of Scope

Validaciones avanzadas de formato y flujo completo de creacion de equipo.
`;

function createMockJiraServer() {
  const worklogs = [];
  const comments = [];
  const issue = {
    id: '10001',
    key: 'PROJ-123',
    fields: {
      summary: 'Carga y persistencia de informacion general del perfil del Director Tecnico',
      status: { name: 'Selected for Development' },
      assignee: { displayName: 'Demo Developer' },
      description: ticketDescription,
    },
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'GET' && url.pathname === '/rest/api/3/issue/PROJ-123') {
        res.writeHead(200);
        res.end(JSON.stringify(issue));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/rest/api/3/search/jql') {
        res.writeHead(200);
        res.end(JSON.stringify({ issues: [issue] }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/rest/api/3/issue/PROJ-123/worklog') {
        const payload = body ? JSON.parse(body) : {};
        const worklog = {
          id: `demo-worklog-${worklogs.length + 1}`,
          issueId: issue.id,
          issueKey: issue.key,
          ...payload,
        };
        worklogs.push(worklog);
        res.writeHead(201);
        res.end(JSON.stringify(worklog));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/rest/api/3/issue/PROJ-123/comment') {
        const payload = body ? JSON.parse(body) : {};
        const comment = {
          id: `demo-comment-${comments.length + 1}`,
          issueId: issue.id,
          issueKey: issue.key,
          ...payload,
        };
        comments.push(comment);
        res.writeHead(201);
        res.end(JSON.stringify(comment));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/_sandbox/worklogs') {
        res.writeHead(200);
        res.end(JSON.stringify(worklogs, null, 2));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/_sandbox/comments') {
        res.writeHead(200);
        res.end(JSON.stringify(comments, null, 2));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found', method: req.method, path: url.pathname }));
    });
  });

  return { server, worklogs, comments };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not resolve mock Jira address'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function runCli(args, options) {
  const command = `osj ${args.join(' ')}`;
  console.log(`\n$ ${command}`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: options.configHome,
        OPENSPEC_TELEMETRY: '0',
        OPENSPEC_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(projectDir, { recursive: true });

  const { server, worklogs, comments } = createMockJiraServer();
  const mockJiraUrl = await listen(server);

  console.log('OpenSpec Jira/Tempo happy path sandbox demo');
  console.log(`Workspace: ${projectDir}`);
  console.log(`Mock Jira: ${mockJiraUrl}`);

  try {
    await runCli(['config', 'set', 'jira.base_url', mockJiraUrl], { cwd: projectDir, configHome });
    await runCli(['config', 'set', 'jira.email', 'demo@example.com'], { cwd: projectDir, configHome });
    await runCli(['config', 'set', 'jira.api_token', 'demo-token'], { cwd: projectDir, configHome });
    await runCli(['config', 'set', 'worklog.rounding', 'minute'], { cwd: projectDir, configHome });
    await runCli(['config', 'set', 'worklog.min_seconds', '60'], { cwd: projectDir, configHome });

    await runCli(['tickets'], { cwd: projectDir, configHome });

    await runCli(['purpose', '--jira', 'PROJ-123', '--import-ticket', '--create-change'], {
      cwd: projectDir,
      configHome,
    });

    const sessionPath = path.join(projectDir, '.openspec', 'session.json');
    const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    const changeName = session.openspec_change.name;

    console.log(`\nGenerated change: ${changeName}`);
    console.log(`Change path: ${path.join(projectDir, 'openspec', 'changes', changeName)}`);

    await runCli(['timer', 'status'], { cwd: projectDir, configHome });
    await runCli(['timer', 'report'], { cwd: projectDir, configHome });
    await runCli(['validate', changeName, '--type', 'change'], { cwd: projectDir, configHome });
    await runCli(['archive', changeName, '--dry-run', '--comment', 'Demo implementation for PROJ-123'], { cwd: projectDir, configHome });
    await runCli(['archive', changeName, '--yes', '--comment', 'Demo implementation for PROJ-123'], {
      cwd: projectDir,
      configHome,
    });

    await fs.writeFile(worklogsPath, `${JSON.stringify(worklogs, null, 2)}\n`, 'utf8');
    await fs.writeFile(commentsPath, `${JSON.stringify(comments, null, 2)}\n`, 'utf8');
    await fs.writeFile(summaryPath, `# Jira Happy Path Demo Output

This directory is generated by:

\`\`\`bash
npm run demo:jira
\`\`\`

## Useful files

- Product repository: \`product-repo/\`
- Archived change: \`product-repo/openspec/changes/archive/\`
- Final spec: \`product-repo/openspec/specs/\`
- Completed timer metadata: \`product-repo/.openspec/sessions/\`
- Mock Jira worklogs: \`mock-jira-worklogs.json\`
- Mock Jira comments: \`mock-jira-comments.json\`

## Generated change

\`${changeName}\`
`, 'utf8');

    console.log('\nMock Jira worklogs created during the demo:');
    console.log(JSON.stringify(worklogs, null, 2));
    console.log('\nMock Jira comments created during the demo:');
    console.log(JSON.stringify(comments, null, 2));
    console.log('\nDemo finished successfully.');
    console.log(`You can inspect generated files in: ${outputRoot}`);
    console.log(`Product repo: ${projectDir}`);
    console.log(`Mock Jira worklogs: ${worklogsPath}`);
    console.log(`Mock Jira comments: ${commentsPath}`);
  } finally {
    await close(server);
  }
}

main().catch((error) => {
  console.error(`\nDemo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
