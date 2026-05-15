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

function sanitizeFinding(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const severity = item.severity;
  const type = typeof item.type === 'string' ? item.type.trim() : '';
  const message = typeof item.message === 'string' ? item.message.trim() : '';
  const file = typeof item.file === 'string' && item.file.trim() ? item.file.trim() : undefined;

  if ((severity !== 'high' && severity !== 'medium' && severity !== 'low') || !type || !message) {
    return null;
  }

  return {
    severity,
    type,
    ...(file ? { file } : {}),
    message,
  };
}

function sanitizeFindings(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => sanitizeFinding(item)).filter(Boolean);
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

async function writeProgress(progressPath, payload) {
  if (!progressPath) {
    return;
  }
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(
    progressPath,
    `${JSON.stringify(
      {
        ...payload,
        updated_at: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
}

function buildPrompt(request) {
  const metadata = request.metadata && Object.keys(request.metadata).length > 0
    ? JSON.stringify(request.metadata, null, 2)
    : null;

  return [
    'You are serving as the Codex CLI backend for the OpenSpec CriticAgent.',
    'Review only. Do not modify files, do not propose workspace_actions, and do not run destructive commands.',
    'Use the workspace context and the provided implementation report summary to decide whether the implementation is approved or requires changes.',
    'Return a final JSON object with keys: review_result, findings, human_questions, limitations.',
    'Allowed review_result values are APPROVED or CHANGES_REQUESTED.',
    'Each finding must include severity, type, optional file, and message.',
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
    '- findings must be an array.',
    '- human_questions must be an array of strings.',
    '- limitations must be an array of strings.',
  ].join('\n');
}

async function runCodex({ workspaceRoot, prompt, outputPath }) {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    process.env.OSJ_CODEX_REVIEW_SANDBOX?.trim() || 'read-only',
    '--output-last-message',
    outputPath,
    '--color',
    'never',
    '--ephemeral',
    '-C',
    workspaceRoot,
  ];

  const useUserConfig = process.env.OSJ_CODEX_REVIEW_USE_USER_CONFIG === '1' || process.env.OSJ_CODEX_USE_USER_CONFIG === '1';
  if (!useUserConfig) {
    args.splice(1, 0, '--ignore-user-config');
  }

  const model = process.env.OSJ_CODEX_REVIEW_MODEL?.trim() || process.env.OSJ_CODEX_MODEL?.trim();
  if (model) {
    args.splice(1, 0, '--model', model);
  }

  const profile = process.env.OSJ_CODEX_REVIEW_PROFILE?.trim() || process.env.OSJ_CODEX_PROFILE?.trim();
  if (profile) {
    args.splice(1, 0, '--profile', profile);
  }

  const addDirs = (
    process.env.OSJ_CODEX_REVIEW_ADD_DIRS
    || process.env.OSJ_CODEX_ADD_DIRS
    || ''
  )
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
  const progressPath = process.env.OSJ_PROGRESS_PATH;
  const workspaceRoot = typeof request.workspace_root === 'string' && request.workspace_root
    ? request.workspace_root
    : process.cwd();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-codex-review-runner-'));
  const outputPath = path.join(tempDir, 'last-message.json');

  try {
    await writeProgress(progressPath, {
      backend_name: request.backend_name ?? 'codex-review',
      agent_name: request.agent_name ?? 'critic_agent',
      run_id: request.run_id ?? null,
      phase: 'thinking',
      phase_source: 'backend',
      input_tokens: null,
      output_tokens: null,
    });

    const prompt = buildPrompt(request);
    const result = await runCodex({
      workspaceRoot,
      prompt,
      outputPath,
    });

    await writeProgress(progressPath, {
      backend_name: request.backend_name ?? 'codex-review',
      agent_name: request.agent_name ?? 'critic_agent',
      run_id: request.run_id ?? null,
      phase: 'finalizing',
      phase_source: 'backend',
      input_tokens: null,
      output_tokens: null,
    });

    const payload = {
      review_result: result.review_result === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : 'APPROVED',
      findings: sanitizeFindings(result.findings),
      human_questions: sanitizeStringArray(result.human_questions),
      limitations: sanitizeStringArray(result.limitations),
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
