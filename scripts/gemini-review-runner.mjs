#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
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
    throw new Error('Gemini CLI did not return a final response.');
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return parseJsonOrThrow(candidate, 'Gemini JSON output');
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
    'You are serving as the Gemini CLI backend for the OpenSpec CriticAgent.',
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

async function runGemini({ workspaceRoot, prompt }) {
  const args = [
    '--prompt',
    prompt,
    '--output-format',
    'json',
    '--skip-trust',
    '--approval-mode',
    process.env.OSJ_GEMINI_REVIEW_APPROVAL_MODE?.trim() || 'default',
  ];

  const model = process.env.OSJ_GEMINI_REVIEW_MODEL?.trim();
  if (model) {
    args.unshift(model);
    args.unshift('--model');
  }

  const includeDirectories = (process.env.OSJ_GEMINI_REVIEW_INCLUDE_DIRECTORIES ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (includeDirectories.length > 0) {
    args.unshift(includeDirectories.join(','));
    args.unshift('--include-directories');
  }

  if (process.env.OSJ_GEMINI_REVIEW_SANDBOX === '1') {
    args.unshift('--sandbox');
  }

  const responseText = await new Promise((resolve, reject) => {
    const child = spawn('gemini', args, {
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
        fail(new Error(`gemini exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ''}`));
        return;
      }
      succeed(stdout);
    });
  });

  const responsePayload = parseJsonOrThrow(responseText, 'Gemini CLI headless JSON output');
  const responseBody = typeof responsePayload?.response === 'string' ? responsePayload.response : '';
  if (!responseBody.trim()) {
    throw new Error('Gemini CLI completed without a response body.');
  }

  return {
    parsedOutput: parseModelJson(responseBody),
    cliPayload: responsePayload,
  };
}

async function main() {
  const rawRequest = await readStdinUtf8();
  const request = parseJsonOrThrow(rawRequest, 'backend request payload');
  const progressPath = process.env.OSJ_PROGRESS_PATH;
  const workspaceRoot = typeof request.workspace_root === 'string' && request.workspace_root
    ? request.workspace_root
    : process.cwd();

  await writeProgress(progressPath, {
    backend_name: request.backend_name ?? 'gemini-review',
    agent_name: request.agent_name ?? 'critic_agent',
    run_id: request.run_id ?? null,
    phase: 'thinking',
    phase_source: 'backend',
    input_tokens: null,
    output_tokens: null,
  });

  const prompt = buildPrompt(request);
  const { parsedOutput, cliPayload } = await runGemini({
    workspaceRoot,
    prompt,
  });

  await writeProgress(progressPath, {
    backend_name: request.backend_name ?? 'gemini-review',
    agent_name: request.agent_name ?? 'critic_agent',
    run_id: request.run_id ?? null,
    phase: 'finalizing',
    phase_source: 'backend',
    input_tokens: null,
    output_tokens: null,
  });

  const payload = {
    review_result: parsedOutput.review_result === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : 'APPROVED',
    findings: sanitizeFindings(parsedOutput.findings),
    human_questions: sanitizeStringArray(parsedOutput.human_questions),
    limitations: sanitizeStringArray(parsedOutput.limitations),
    cli_stats: cliPayload?.stats ?? null,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
