import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');

type RequestRecord = { method: string; url: string; body: Record<string, unknown> };
type CliResult = { code: number; stdout: string; stderr: string };

let server: http.Server;
let baseUrl = '';
let requests: RequestRecord[] = [];

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });
      const conversationMatch = (req.url ?? '').match(/^\/api\/projects\/([^/]+)\/conversations(?:\/([^/]+))?$/);
      if (!conversationMatch) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: req.url } });
        return;
      }
      const conversation: Record<string, unknown> = {
        id: conversationMatch[2] ?? 'conversation-1',
        projectId: decodeURIComponent(conversationMatch[1]!),
        title: typeof body.title === 'string' ? body.title : null,
        sessionMode: typeof body.sessionMode === 'string' ? body.sessionMode : 'design',
      };
      if (body.executor) conversation.executor = body.executor;
      sendJson(res, 200, { conversation });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  requests = [];
});

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [tsxCli, cliEntry, ...args, '--daemon-url', baseUrl],
      {
        cwd: daemonRoot,
        env: { ...process.env, NODE_OPTIONS: '' },
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('od conversation executor flags', () => {
  it('conversation new --agent sends a Local CLI executor and names it in the summary', async () => {
    const result = await runCli([
      'conversation', 'new', 'project-1', '--agent', 'codex', '--model', 'gpt-5.5', '--reasoning', 'high',
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/projects/project-1/conversations',
    });
    expect(requests[0]?.body.executor).toEqual({
      mode: 'daemon',
      agentId: 'codex',
      agentModel: { model: 'gpt-5.5', reasoning: 'high' },
    });
    expect(result.stdout).toContain('executor=codex');
  });

  it('conversation new without executor flags sends no executor', async () => {
    const result = await runCli(['conversation', 'new', 'project-1', '--json']);

    expect(result.code, result.stderr).toBe(0);
    expect(Object.hasOwn(requests[0]?.body ?? {}, 'executor')).toBe(false);
  });

  it('chat new honors the same executor flags', async () => {
    const result = await runCli([
      'chat', 'new', '--project', 'project-1', '--byok-protocol', 'anthropic', '--model', 'claude-x',
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(requests[0]?.body.executor).toEqual({
      mode: 'api',
      apiProtocol: 'anthropic',
      model: 'claude-x',
    });
    expect(result.stdout).toContain('executor=byok:anthropic');
  });

  it('conversation update --byok-protocol PATCHes a BYOK executor', async () => {
    const result = await runCli([
      'conversation', 'update', 'project-1', 'conv-9', '--byok-protocol', 'openai', '--model', 'gpt-4o', '--json',
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/projects/project-1/conversations/conv-9',
      body: { executor: { mode: 'api', apiProtocol: 'openai', model: 'gpt-4o' } },
    });
    const printed = JSON.parse(result.stdout) as { conversation: { executor?: unknown } };
    expect(printed.conversation.executor).toEqual({ mode: 'api', apiProtocol: 'openai', model: 'gpt-4o' });
  });

  it('conversation update --clear-executor sends null', async () => {
    const result = await runCli(['conversation', 'update', 'project-1', 'conv-9', '--clear-executor']);

    expect(result.code, result.stderr).toBe(0);
    expect(requests).toHaveLength(1);
    expect(Object.hasOwn(requests[0]!.body, 'executor')).toBe(true);
    expect(requests[0]?.body.executor).toBeNull();
    expect(result.stdout).toContain('conv-9');
  });

  it('conversation update carries --title and --mode without touching the executor', async () => {
    const result = await runCli([
      'conversation', 'update', 'project-1', 'conv-9', '--title', 'Renamed', '--mode', 'plan',
    ]);

    expect(result.code, result.stderr).toBe(0);
    expect(requests[0]?.body).toEqual({ title: 'Renamed', sessionMode: 'plan' });
  });

  it.each([
    ['--agent with --byok-protocol', ['conversation', 'new', 'project-1', '--agent', 'codex', '--byok-protocol', 'openai']],
    ['--reasoning with --byok-protocol', ['conversation', 'update', 'project-1', 'conv-9', '--byok-protocol', 'openai', '--reasoning', 'high']],
    ['--model without a runtime', ['conversation', 'update', 'project-1', 'conv-9', '--model', 'gpt-5.5']],
    ['--clear-executor with --agent', ['conversation', 'update', 'project-1', 'conv-9', '--clear-executor', '--agent', 'codex']],
    ['an update with nothing to change', ['conversation', 'update', 'project-1', 'conv-9']],
    ['an update without a conversation id', ['conversation', 'update', 'project-1', '--title', 'x']],
    ['an invalid --mode on update', ['conversation', 'update', 'project-1', 'conv-9', '--mode', 'review']],
    ['a BYOK credential flag', ['conversation', 'new', 'project-1', '--byok-protocol', 'openai', '--byok-key-env', 'OPENAI_API_KEY']],
  ])('rejects %s before any request', async (_label, args) => {
    const result = await runCli(args);

    expect(result.code).not.toBe(0);
    expect(requests).toHaveLength(0);
  });

  it('exits 2 for conflicting executor flags', async () => {
    const result = await runCli([
      'conversation', 'new', 'project-1', '--agent', 'codex', '--byok-protocol', 'openai',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/--agent.*--byok-protocol/);
  });

  it('documents update and the executor flags in conversation help', async () => {
    const result = await runCli(['conversation', 'help']);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('od conversation update');
    expect(result.stdout).toContain('--clear-executor');
    expect(result.stdout).toContain('--byok-protocol');
  });
});
