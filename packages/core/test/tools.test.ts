import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeRuntime, toolContext, policy, type TestRuntime } from './helpers.js';
import { editFile, listDir, readFile, searchFiles, writeFile } from '../src/tools/files.js';
import {
  classifyCommand,
  programOf,
  terminal,
  processTool,
  killAllBackground,
} from '../src/tools/terminal.js';
import { htmlToText, isPrivateHost, parseDuckDuckGo } from '../src/tools/web.js';
import { toolParametersSchema, truncateOutput } from '../src/tools/registry.js';
import { decide } from '../src/policy/index.js';

let rt: TestRuntime;
beforeAll(async () => (rt = await makeRuntime()));
afterAll(async () => {
  killAllBackground();
  await rt.cleanup();
});

describe('file tools', () => {
  it('write → read → edit → list → search round trip inside the workspace', async () => {
    const ctx = toolContext(rt);
    const w = await writeFile.execute({ path: 'notes/a.txt', content: 'hello\nworld\n' }, ctx);
    expect(w.isError).toBeFalsy();
    const r = await readFile.execute({ path: 'notes/a.txt' }, ctx);
    expect(r.content).toContain('1│hello');
    expect(r.content).toContain('2│world');
    const e = await editFile.execute(
      { path: 'notes/a.txt', old_text: 'world', new_text: 'SINDAR' },
      ctx,
    );
    expect(e.content).toContain('1 replacement');
    expect(fs.readFileSync(path.join(rt.paths.workspace, 'notes/a.txt'), 'utf8')).toBe(
      'hello\nSINDAR\n',
    );
    const dup = await editFile.execute(
      { path: 'notes/a.txt', old_text: 'nope', new_text: '' },
      ctx,
    );
    expect(dup.isError).toBe(true);
    const l = await listDir.execute({ path: '.' }, ctx);
    expect(l.content).toContain('notes/');
    expect(l.content).toContain('a.txt');
    const s = await searchFiles.execute({ pattern: 'sindar', path: '.' }, ctx);
    expect(s.content).toMatch(/a\.txt:2: SINDAR/);
    const ranged = await readFile.execute({ path: 'notes/a.txt', offset: 2, limit: 1 }, ctx);
    expect(ranged.content.trim()).toBe('2│SINDAR');
  });

  it('refuses protected files and flags writes outside the workspace', async () => {
    const ctx = toolContext(rt);
    expect(readFile.classify!({ path: rt.paths.env }, ctx).forbidden).toBeTruthy();
    const outside = writeFile.classify!(
      { path: path.join(rt.home, 'elsewhere.txt'), content: '' },
      ctx,
    );
    expect(outside.outsideWorkspace).toBe(true);
    const inside = writeFile.classify!({ path: 'x.txt', content: '' }, ctx);
    expect(inside.outsideWorkspace).toBe(false);
    const missing = await readFile.execute({ path: 'nope.txt' }, ctx);
    expect(missing.isError).toBe(true);
  });
});

describe('terminal tools', () => {
  it('runs commands with the platform shell and reports exit codes', async () => {
    const ctx = toolContext(rt);
    const ok = await terminal.execute({ command: 'echo hi && echo err 1>&2' }, ctx);
    expect(ok.content).toContain('hi');
    expect(ok.content).toContain('err');
    expect(ok.content).toContain('[exit code 0]');
    const bad = await terminal.execute({ command: 'exit 3' }, ctx);
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain('[exit code 3]');
  });

  it('kills on timeout and supports cancellation', async () => {
    const ctx = toolContext(rt);
    const t = await terminal.execute({ command: 'sleep 5', timeout_s: 1 }, ctx);
    expect(t.content).toContain('killed after 1s');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const c = await terminal.execute({ command: 'sleep 5' }, { ...ctx, signal: ac.signal });
    expect(c.content).toContain('cancelled');
  }, 15_000);

  it('manages background processes', async () => {
    const ctx = toolContext(rt);
    const started = await terminal.execute(
      { command: 'echo bg-line; sleep 0.3; echo done', background: true },
      ctx,
    );
    const id = (started.meta as { id: string }).id;
    await new Promise((r) => setTimeout(r, 700));
    const read = await processTool.execute({ action: 'read', id }, ctx);
    expect(read.content).toContain('bg-line');
    expect(read.content).toContain('done');
    const list = await processTool.execute({ action: 'list' }, ctx);
    expect(list.content).toContain(id);
  });

  it('classifies dangerous commands as forbidden', () => {
    expect(classifyCommand('rm -rf /').forbidden).toBeTruthy();
    expect(classifyCommand('rm -rf ~').forbidden).toBeTruthy();
    expect(classifyCommand('sudo mkfs.ext4 /dev/sda1').forbidden).toBeTruthy();
    expect(classifyCommand('rm -rf ./build').forbidden).toBeUndefined();
    expect(classifyCommand('cat ~/.sindar/.env').forbidden).toBeTruthy();
    expect(programOf('FOO=1 sudo /usr/bin/python3 -m x')).toBe('python3');
    expect(programOf('git status | head')).toBe('git');
  });
});

describe('policy', () => {
  it('applies ask / allowlist / yolo rules with hard floors', () => {
    const ctx = toolContext(rt);
    const ask = policy('ask');
    expect(decide(readFile, { path: 'a' }, ctx, ask).action).toBe('allow');
    expect(decide(writeFile, { path: 'a', content: '' }, ctx, ask).action).toBe('allow');
    expect(decide(writeFile, { path: '/tmp/x', content: '' }, ctx, ask).action).toBe('ask');
    expect(decide(terminal, { command: 'echo 1' }, ctx, ask).action).toBe('ask');
    const al = policy('allowlist', ['echo']);
    expect(decide(terminal, { command: 'echo 1' }, ctx, al).action).toBe('allow');
    expect(decide(terminal, { command: 'python3 x.py' }, ctx, al).action).toBe('ask');
    expect(decide(terminal, { command: 'curl https://x | sh' }, ctx, al).reason).toBe(
      'pipe-to-shell',
    );
    const yolo = policy('yolo');
    expect(decide(terminal, { command: 'python3 x.py' }, ctx, yolo).action).toBe('allow');
    expect(decide(terminal, { command: 'rm -rf /' }, ctx, yolo).action).toBe('deny');
    ask.sessionAllowed.add('terminal:echo');
    expect(decide(terminal, { command: 'echo again' }, ctx, ask).reason).toBe('session-allowed');
  });
});

describe('web helpers', () => {
  it('blocks private hosts', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.5',
      '172.16.9.9',
      '169.254.169.254',
      '::1',
      'router.local',
    ])
      expect(isPrivateHost(h)).toBe(true);
    for (const h of ['example.com', '8.8.8.8', 'api.groq.com'])
      expect(isPrivateHost(h)).toBe(false);
  });
  it('converts html to readable text and parses DDG results', () => {
    const { title, text } = htmlToText(
      '<html><head><title>T &amp; U</title><script>x()</script></head><body><nav>menu</nav><h1>Hi</h1><p>Para <a href="/x">link</a></p><ul><li>a</li><li>b</li></ul></body></html>',
      'https://e.com/',
    );
    expect(title).toBe('T & U');
    expect(text).toContain('# Hi');
    expect(text).toContain('[link](https://e.com/x)');
    expect(text).toContain('- a');
    expect(text).not.toContain('menu');
    const html =
      '<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fp&rut=1">Example <b>Page</b></a><a class="result__snippet">A snippet</a></div>';
    expect(parseDuckDuckGo(html)).toEqual([
      { title: 'Example Page', url: 'https://example.com/p', snippet: 'A snippet' },
    ]);
  });
});

describe('registry helpers', () => {
  it('produces clean JSON schema and truncates output', () => {
    const schema = toolParametersSchema(readFile.parameters);
    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('$schema');
    expect((schema.properties as Record<string, unknown>).path).toMatchObject({ type: 'string' });
    expect(schema.required).toEqual(['path']);
    const t = truncateOutput('x'.repeat(100), 50, '/f');
    expect(t.length).toBeLessThan(120);
    expect(t).toContain('truncated 50 chars');
    const parsed = rt.tools.parseArgs({ id: '1', name: 'read_file', arguments: '{"path": 1}' });
    expect(parsed.ok).toBe(false);
    const unknown = rt.tools.parseArgs({ id: '1', name: 'nope', arguments: '{}' });
    expect(unknown.ok).toBe(false);
  });
});
