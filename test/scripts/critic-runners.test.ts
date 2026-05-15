import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { spawn } from 'node:child_process';
import { promises as fs } from 'fs';

async function writeExecutable(binDir: string, name: string, source: string): Promise<void> {
  const executablePath = path.join(binDir, name);
  await fs.writeFile(executablePath, source, 'utf-8');
  await fs.chmod(executablePath, 0o755);
}

async function runNodeScript(scriptPath: string, input: string, env: NodeJS.ProcessEnv): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: '/Users/pm-ebrana/Documents/Replace/OpenSpec',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `script exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(input);
  });
}

describe('critic review runners', () => {
  let tempDir: string;
  let binDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-critic-runners-test-'));
    binDir = path.join(tempDir, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs Codex review runner in headless mode and parses its JSON output', async () => {
    await writeExecutable(
      binDir,
      'codex',
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (!args.includes('exec') || !args.includes('--ephemeral') || !args.includes('--sandbox')) {
  console.error('missing expected codex flags');
  process.exit(1);
}
const outputIndex = args.indexOf('--output-last-message');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';
if (!outputPath) {
  console.error('missing output path');
  process.exit(1);
}
const prompt = args[args.length - 1] || '';
if (!prompt.includes('CriticAgent')) {
  console.error('missing critic prompt marker');
  process.exit(1);
}
fs.writeFileSync(outputPath, JSON.stringify({
  review_result: 'CHANGES_REQUESTED',
  findings: [
    {
      severity: 'medium',
      type: 'semantic_gap',
      file: 'src/critic-flow.ts',
      message: 'Missing review detail'
    }
  ],
  human_questions: ['Confirm intended fallback behavior.'],
  limitations: ['Synthetic test backend.']
}), 'utf8');
`
    );

    const requestPayload = {
      agent_name: 'critic_agent',
      backend_name: 'codex-review',
      workspace_root: tempDir,
      task_prompt: 'Review this implementation.',
      system_prompt: 'Return JSON.',
      metadata: {
        likely_affected_files: ['src/critic-flow.ts'],
      },
    };

    const stdout = await runNodeScript('scripts/codex-review-runner.mjs', JSON.stringify(requestPayload), process.env);

    expect(JSON.parse(stdout)).toEqual({
      review_result: 'CHANGES_REQUESTED',
      findings: [
        {
          severity: 'medium',
          type: 'semantic_gap',
          file: 'src/critic-flow.ts',
          message: 'Missing review detail',
        },
      ],
      human_questions: ['Confirm intended fallback behavior.'],
      limitations: ['Synthetic test backend.'],
    });
  });

  it('runs Gemini review runner in headless JSON mode and parses the embedded response JSON', async () => {
    await writeExecutable(
      binDir,
      'gemini',
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args.includes('--prompt') || !args.includes('--output-format') || !args.includes('json')) {
  console.error('missing expected gemini headless flags');
  process.exit(1);
}
const promptIndex = args.indexOf('--prompt');
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : '';
if (!prompt.includes('CriticAgent')) {
  console.error('missing critic prompt marker');
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  response: JSON.stringify({
    review_result: 'APPROVED',
    findings: [],
    human_questions: [],
    limitations: ['Synthetic Gemini backend.']
  }),
  stats: {
    models: {
      'gemini-2.5-pro': {
        inputTokens: 128,
        outputTokens: 32
      }
    }
  }
}));
`
    );

    const requestPayload = {
      agent_name: 'critic_agent',
      backend_name: 'gemini-review',
      workspace_root: tempDir,
      task_prompt: 'Review this implementation.',
      system_prompt: 'Return JSON.',
      metadata: {
        likely_affected_files: ['src/critic-flow.ts'],
      },
    };

    const stdout = await runNodeScript('scripts/gemini-review-runner.mjs', JSON.stringify(requestPayload), process.env);

    expect(JSON.parse(stdout)).toEqual({
      review_result: 'APPROVED',
      findings: [],
      human_questions: [],
      limitations: ['Synthetic Gemini backend.'],
      cli_stats: {
        models: {
          'gemini-2.5-pro': {
            inputTokens: 128,
            outputTokens: 32,
          },
        },
      },
    });
  });
});
