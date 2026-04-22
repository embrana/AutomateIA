#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseJsonOrThrow(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseModelJson(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Codex did not return a final message.');
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return parseJsonOrThrow(candidate, 'Codex JSON output');
}

function sanitizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function sanitizeWorkspaceActions(value) {
  return Array.isArray(value) ? value : [];
}

function resolveSandboxMode(request) {
  return request.backend_config?.sandbox_mode
    ?? process.env.OSJ_CODEX_SANDBOX
    ?? 'read-only';
}

function resolveImplementationMode(request) {
  return request.backend_config?.implementation_mode
    ?? process.env.OSJ_CODEX_IMPLEMENTATION_MODE
    ?? 'workspace_actions';
}

async function readStdinUtf8() {
  if (process.stdin.isTTY) {
    return '';
  }

  return await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', reject);
  });
}

function buildPrompt(request) {
  const metadata = request.metadata && Object.keys(request.metadata).length > 0
    ? JSON.stringify(request.metadata, null, 2)
    : null;
  const implementationMode = resolveImplementationMode(request);
  const directEdit = implementationMode === 'direct_edit';

  return [
    'You are serving as the Codex CLI backend for the OpenSpec ImplementationAgent.',
    directEdit
      ? 'You may modify files directly in the repository. Keep edits minimal, production-ready, and within the declared constraints.'
      : 'Work in analysis mode only. Do not modify files directly in the repository.',
    'Inspect the workspace and return a final JSON object that matches the provided output schema.',
    directEdit
      ? 'If you make direct edits, summarize them in the final JSON. workspace_actions are optional and should only be used for extra bounded runtime actions.'
      : 'Prefer proposing minimal workspace_actions so the OpenSpec runtime can apply them under policy.',
    'Use run_command only for focused verification commands such as node --test, pnpm exec vitest, pnpm exec tsc --noEmit, npm test, or yarn test.',
    directEdit
      ? 'If the task is ambiguous or too risky, avoid broad edits, explain the limitation, and keep changes minimal.'
      : 'If the task is ambiguous or too risky, keep workspace_actions empty and explain the limitation or question.',
    '',
    '# Runtime System Prompt',
    request.system_prompt ?? '(none)',
    '',
    '# Runtime Task Prompt',
    request.task_prompt,
    '',
    ...(metadata
      ? ['# Runtime Metadata', metadata, '']
      : []),
    '# Final Output Rules',
    '- Return JSON only.',
    '- Do not wrap the JSON in markdown fences.',
    '- workspace_actions must contain only supported action objects.',
  ].join('\n');
}

async function runCodex({ workspaceRoot, prompt, outputPath, request }) {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    resolveSandboxMode(request),
    '--output-last-message',
    outputPath,
    '--color',
    'never',
    '--ephemeral',
    '-C',
    workspaceRoot,
  ];

  const useUserConfig = process.env.OSJ_CODEX_USE_USER_CONFIG === '1';
  if (!useUserConfig) {
    args.splice(1, 0, '--ignore-user-config');
  }

  const model = process.env.OSJ_CODEX_MODEL?.trim();
  if (model) {
    args.splice(1, 0, '--model', model);
  }

  const profile = process.env.OSJ_CODEX_PROFILE?.trim();
  if (profile) {
    args.splice(1, 0, '--profile', profile);
  }

  const addDirs = (process.env.OSJ_CODEX_ADD_DIRS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  for (const addDir of addDirs) {
    args.splice(1, 0, '--add-dir', addDir);
  }

  args.push(prompt);

  const response = await new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    const succeed = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`codex exec exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ''}`));
        return;
      }
      succeed({ stdout, stderr });
    });
  });

  let outputText = '';
  try {
    outputText = await fs.readFile(outputPath, 'utf-8');
  } catch {
    outputText = response.stdout;
  }

  if (!outputText.trim()) {
    throw new Error('Codex completed without producing a final JSON message.');
  }

  return parseModelJson(outputText);
}

async function main() {
  const rawRequest = await readStdinUtf8();
  const request = parseJsonOrThrow(rawRequest, 'backend request payload');
  const workspaceRoot = typeof request.workspace_root === 'string' && request.workspace_root
    ? request.workspace_root
    : process.cwd();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-codex-runner-'));
  const outputPath = path.join(tempDir, 'last-message.json');

  try {
    const prompt = buildPrompt(request);
    const result = await runCodex({
      workspaceRoot,
      prompt,
      outputPath,
      request,
    });

    const payload = {
      status: typeof result.status === 'string' ? result.status : 'drafted',
      summary: typeof result.summary === 'string'
        ? result.summary
        : 'Codex backend returned a structured response without a summary.',
      files_touched: sanitizeStringArray(result.files_touched),
      tests_added: sanitizeStringArray(result.tests_added),
      limitations: sanitizeStringArray(result.limitations),
      human_questions: sanitizeStringArray(result.human_questions),
      workspace_actions: sanitizeWorkspaceActions(result.workspace_actions),
    };

    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
