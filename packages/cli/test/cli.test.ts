import { describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchReleaseInfo,
  parseVersionOutput,
  sameBuild,
  tarballUrl,
  versionUrl,
} from '../src/commands/update.js';
import { stepsFor } from '../src/commands/background.js';
import { connectLink, enableExternalApps } from '../src/commands/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const bin = path.join(root, 'packages/cli/dist/index.js');
const hasBuild = fs.existsSync(bin);

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env, NO_COLOR: '1' },
  });
}

describe('dependency sync (bundle contract)', () => {
  it('cli declares every runtime dependency of the packages it inlines', () => {
    const read = (p: string) =>
      JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
    const cli = read('packages/cli/package.json').dependencies ?? {};
    for (const pkg of ['packages/core/package.json', 'packages/gateway/package.json']) {
      for (const [dep, range] of Object.entries(read(pkg).dependencies ?? {})) {
        expect(cli[dep], `${dep} from ${pkg} must be a dependency of the cli`).toBe(range);
      }
    }
  });

  it('builds a stable tarball url', () => {
    expect(tarballUrl('o/r', 'dev')).toBe(
      'https://github.com/o/r/releases/download/dev/sindar-cli.tgz',
    );
    expect(versionUrl('o/r', 'dev')).toBe(
      'https://github.com/o/r/releases/download/dev/version.json',
    );
  });

  it('update: compares builds, parses --version output and tolerates offline release info', async () => {
    expect(sameBuild('4271e31', '4271e31abcdef0123456789abcdef0123456789a')).toBe(true);
    expect(sameBuild('4271e31', '4271e32')).toBe(false);
    expect(sameBuild('local', 'local')).toBe(true); // identical strings always match
    expect(sameBuild('abc', 'abcdef0')).toBe(false); // too short to mean anything
    expect(sameBuild(undefined, 'abc')).toBe(false);
    expect(parseVersionOutput('0.1.0 (4271e31)\n')).toEqual({ version: '0.1.0', build: '4271e31' });
    expect(parseVersionOutput('garbage')).toBeUndefined();

    const okFetch = (async () =>
      new Response(JSON.stringify({ version: '0.1.0', sha: 'abc1234def' }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await fetchReleaseInfo('https://x/version.json', 1000, okFetch)).toEqual({
      version: '0.1.0',
      sha: 'abc1234def',
    });
    const failFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchReleaseInfo('https://x/version.json', 1000, failFetch)).toBeUndefined();
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchReleaseInfo('https://x/version.json', 1000, notFound)).toBeUndefined();
  });

  it('app: builds the deep link and enables allow-external-apps idempotently', () => {
    expect(connectLink('http://127.0.0.1:18789', 'a b&c')).toBe(
      'sindar://connect?url=http%3A%2F%2F127.0.0.1%3A18789&token=a%20b%26c',
    );
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-app-'));
    const file = path.join(tmpHome, '.termux', 'termux.properties');
    // 1) no file yet → created with the line
    expect(enableExternalApps(tmpHome)).toEqual({ changed: true, file });
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^allow-external-apps = true$/m);
    // 2) already enabled → untouched
    expect(enableExternalApps(tmpHome).changed).toBe(false);
    // 3) Termux's default commented line (and a false value) get replaced, other lines survive
    fs.writeFileSync(file, 'extra-keys = [[ESC]]\n# allow-external-apps = true\n');
    expect(enableExternalApps(tmpHome).changed).toBe(true);
    let text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('extra-keys = [[ESC]]');
    expect(text.match(/allow-external-apps/g)).toHaveLength(1);
    expect(text).toMatch(/^allow-external-apps = true$/m);
    fs.writeFileSync(file, 'allow-external-apps=false\n');
    expect(enableExternalApps(tmpHome).changed).toBe(true);
    text = fs.readFileSync(file, 'utf8');
    expect(text.trim()).toBe('allow-external-apps = true');
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('picks vendor-specific background steps', () => {
    expect(stepsFor('HUAWEI')).toEqual(['battery', 'launch', 'sleep', 'data', 'lock']);
    expect(stepsFor('Xiaomi')).toContain('autostart');
    expect(stepsFor('samsung')).toContain('samsung');
    expect(stepsFor('')).toEqual(['battery', 'data', 'lock']);
  });
});

describe.skipIf(!hasBuild)('built binary', () => {
  it('prints the version', () => {
    const r = run(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('background: guides on Termux, is a no-op elsewhere', () => {
    const off = run(['background']);
    expect(off.status).toBe(0);
    expect(off.stdout).toMatch(/Termux/);
    expect(off.stdout).not.toMatch(/1\/3/);
    const termux = run(['--lang', 'en', 'background', '--no-open'], {
      TERMUX_VERSION: '0.118.0',
      PREFIX: '/data/data/com.termux/files/usr',
    });
    expect(termux.status).toBe(0);
    expect(termux.stdout).toContain('Step 1/3');
    expect(termux.stdout).toContain('Lock Termux in Recents');
    expect(termux.stdout).toContain('sindar gateway restart');
  });

  it.skipIf(process.platform === 'win32')('background: Huawei gets its own steps and paths', () => {
    // Fake `getprop` so the brand detection sees an EMUI phone.
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-fakebin-'));
    try {
      const getprop = path.join(fake, 'getprop');
      fs.writeFileSync(
        getprop,
        '#!/bin/sh\ncase "$1" in ro.product.manufacturer) echo HUAWEI;; ro.product.model) echo VOG-L29;; *) echo 10;; esac\n',
      );
      fs.chmodSync(getprop, 0o755);
      const r = run(['--lang', 'en', 'background', '--no-open'], {
        TERMUX_VERSION: '0.118.0',
        PREFIX: '/data/data/com.termux/files/usr',
        PATH: `${fake}${path.delimiter}${process.env['PATH'] ?? ''}`,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('HUAWEI VOG-L29');
      expect(r.stdout).toContain('Step 1/5');
      expect(r.stdout).toContain('Special access');
      expect(r.stdout).toContain('App launch');
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it('runs doctor with --json in an isolated home and exits 0', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-cli-'));
    try {
      const r = run(['doctor', '--json', '--no-probe'], { SINDAR_HOME: home });
      expect(r.stderr).not.toMatch(/ExperimentalWarning/);
      expect(r.status).toBe(0);
      const report = JSON.parse(r.stdout);
      expect(report.summary.fail).toBe(0);
      expect(report.home).toBe(home);
      const pretty = run(['--lang', 'en', 'doctor', '--no-probe'], { SINDAR_HOME: home });
      expect(pretty.stdout).toContain('SINDAR Doctor');
      expect(pretty.stdout).toContain('Database:');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });

describe.skipIf(!hasBuild || process.platform === 'win32')(
  'gateway stop finds orphan brains',
  () => {
    it('stops an old `gateway run` that has no pid file and no shutdown endpoint', async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-cli-orphan-'));
      const port = await freePort();
      fs.writeFileSync(path.join(home, 'config.yaml'), `gateway:\n  port: ${port}\n`);
      // A stand-in for a pre-30b7a8a brain: answers /health, 404s everything else, no pid file.
      const fakeDir = path.join(home, 'sindar-old', 'dist');
      fs.mkdirSync(fakeDir, { recursive: true });
      const fake = path.join(fakeDir, 'index.js');
      fs.writeFileSync(
        fake,
        `const http = require('node:http');
const srv = http.createServer((req, res) => {
  if (req.url === '/health') return res.end(JSON.stringify({ ok: true, name: 'sindar', version: '0.0.1', build: 'deadbeefcafe', uptimeS: 1, model: 'mock:echo', sessions: 0, running: 0, pending: 0, platform: { os: 'linux', isTermux: false } }));
  res.statusCode = 404; res.end('{}');
});
srv.listen(${port}, '127.0.0.1', () => console.log('up'));
process.on('SIGTERM', () => srv.close(() => process.exit(0)));`,
      );
      let child: ChildProcess | undefined;
      try {
        child = spawn(process.execPath, [fake, '--home', home, 'gateway', 'run'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        await new Promise<void>((resolve) => child!.stdout!.once('data', () => resolve()));
        const exited = new Promise<number | null>((resolve) =>
          child!.once('exit', (c) => resolve(c)),
        );

        const status = run(['--lang', 'en', 'gateway', 'status'], { SINDAR_HOME: home });
        expect(status.stdout).toContain('running');
        expect(status.stdout).toContain('deadbee');

        const stop = run(['--lang', 'en', 'gateway', 'stop'], { SINDAR_HOME: home });
        expect(stop.stdout).toContain(`process ${child.pid}`);
        expect(stop.stdout).toContain('stopped');
        expect(stop.status).toBe(0);
        await expect(
          Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 5000))]),
        ).resolves.not.toBe('timeout');
        expect(run(['--lang', 'en', 'gateway', 'status'], { SINDAR_HOME: home }).stdout).toContain(
          'not running',
        );
      } finally {
        child?.kill('SIGKILL');
        fs.rmSync(home, { recursive: true, force: true });
      }
    }, 30_000);
  },
);

describe.skipIf(!hasBuild)('chat / onboard / config (mock provider)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-cli-m1-'));
  const env = { SINDAR_HOME: home };

  it('onboard can run non-interactively and writes config + env', () => {
    const r = run(
      [
        '--lang',
        'en',
        'onboard',
        '--provider',
        'groq',
        '--key',
        'gsk_fake_key_for_tests',
        '--model',
        'llama-3.3-70b-versatile',
        '--approval',
        'allowlist',
        '-y',
        '--no-test',
      ],
      env,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Saved: default model groq:llama-3.3-70b-versatile');
    expect(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')).toContain(
      'default: groq:llama-3.3-70b-versatile',
    );
    expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toContain(
      'GROQ_API_KEY=gsk_fake_key_for_tests',
    );
    const model = run(['--lang', 'en', 'model'], env);
    expect(model.stdout).toContain('Default model: groq:llama-3.3-70b-versatile');
    expect(model.stdout).toMatch(/groq\s+ready/);
  });

  it('onboard replaces a retired --model with one the provider still lists (Gemini 404 case)', async () => {
    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-cli-retired-'));
    const port = await freePort();
    // A stand-in for Google's endpoint in Oct 2026: /models lists 3.8, 2.5 answers 404 "no longer
    // available". Runs as its own process because `run()` blocks this one with spawnSync.
    const fake = path.join(home2, 'fake-gemini.cjs');
    fs.writeFileSync(
      fake,
      `const http = require('node:http');
const sse = (res, text) => {
  res.setHeader('content-type', 'text/event-stream');
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\\n\\n');
  res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\\n\\n');
  res.end('data: [DONE]\\n\\n');
};
const srv = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ data: [
      { id: 'models/gemini-3.8-flash-lite' }, { id: 'models/gemini-3.8-flash' }, { id: 'models/gemini-embedding-001' },
    ] }));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const model = JSON.parse(body).model;
    if (model !== 'gemini-3.8-flash') {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { message: 'This model models/' + model + ' is no longer available to new users. Please update your code to use models/gemini-3.8-flash' } }));
    }
    sse(res, 'Hello from 3.8!');
  });
});
srv.listen(${port}, '127.0.0.1', () => console.log('up'));
process.on('SIGTERM', () => srv.close(() => process.exit(0)));`,
    );
    let child: ChildProcess | undefined;
    try {
      child = spawn(process.execPath, [fake], { stdio: ['ignore', 'pipe', 'ignore'] });
      await new Promise<void>((resolve) => child!.stdout!.once('data', () => resolve()));
      const env2 = { SINDAR_HOME: home2, GEMINI_BASE_URL: `http://127.0.0.1:${port}` };
      const r = run(
        [
          '--lang',
          'en',
          'onboard',
          '--provider',
          'gemini',
          '--key',
          'AIza_fake',
          '--model',
          'gemini-2.5-flash',
          '--approval',
          'ask',
          '-y',
        ],
        env2,
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('gemini-2.5-flash is no longer available to your key');
      expect(r.stdout).toContain('Hello from 3.8!');
      const cfg = fs.readFileSync(path.join(home2, 'config.yaml'), 'utf8');
      expect(cfg).toContain('default: gemini:gemini-3.8-flash');
      expect(cfg).toContain('gemini:gemini-3.8-flash-lite');
      expect(cfg).not.toContain('2.5');

      // `sindar model <retired>` warns and names the closest live model
      const m = run(['--lang', 'en', 'model', 'gemini:gemini-2.5-flash'], env2);
      expect(m.stdout).toContain('does not list gemini:gemini-2.5-flash');
      expect(m.stdout).toContain('Closest available: gemini:gemini-3.8-flash');
    } finally {
      child?.kill('SIGKILL');
      fs.rmSync(home2, { recursive: true, force: true });
    }
  });

  it('config set/get validate values', () => {
    expect(run(['config', 'set', 'model.default', 'mock:echo'], env).status).toBe(0);
    expect(run(['config', 'get', 'model.default'], env).stdout.trim()).toBe('mock:echo');
    const bad = run(['--lang', 'en', 'config', 'set', 'agent.approvalMode', 'maybe'], env);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('Invalid value');
  });

  it('one-shot chat streams the mock reply, runs read tools, and declines exec without a TTY', () => {
    const hello = run(['--lang', 'en', 'chat', 'hello', 'there'], env);
    expect(hello.status).toBe(0);
    expect(hello.stdout.trim()).toBe('echo: hello there');
    const ws = path.join(home, 'workspace');
    fs.writeFileSync(path.join(ws, 'hi.txt'), 'line-one\n');
    const read = run(
      ['--lang', 'en', 'chat', '--cwd', ws, '!tool read_file {"path":"hi.txt"}'],
      env,
    );
    expect(read.stdout).toContain('⚙ read hi.txt');
    expect(read.stdout).toContain('tool-result:read_file:1│line-one');
    const denied = run(
      ['--lang', 'en', 'chat', '--approval', 'ask', '!tool terminal {"command":"echo nope"}'],
      env,
    );
    expect(denied.stdout).toContain('denied');
    expect(denied.stdout).not.toContain('[exit code 0]');
    const yolo = run(
      ['--lang', 'en', 'chat', '--yolo', '!tool terminal {"command":"echo ran"}'],
      env,
    );
    expect(yolo.stdout).toContain('[exit code 0]');
    const sessions = run(['--lang', 'en', 'sessions'], env);
    expect(sessions.stdout).toContain('Recent sessions:');
    expect(sessions.stdout).toContain('hello there');
    const resumed = run(['--lang', 'en', 'chat', '-c', 'again'], env);
    expect(resumed.stdout.trim()).toBe('echo: again');
  });

  it('reports a clear error when the provider has no key', () => {
    run(['config', 'set', 'model.default', 'gemini:gemini-2.5-flash'], env);
    const r = run(['--lang', 'en', 'chat', 'hi'], env);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no API key');
    expect(r.stderr).toContain('sindar onboard');
    run(['config', 'set', 'model.default', 'mock:echo'], env);
  });

  it('app install prints the APK link without opening anything', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-home-'));
    const r = run(['--home', tmpHome, 'app', 'install', '--no-open']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('releases/download/dev/SINDAR-dev.apk');
    expect(r.stdout).toContain('sindar app connect');
    const bad = run(['--home', tmpHome, 'app', 'nonsense', '--no-open']);
    expect(bad.status).toBe(2);
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('telegram: status/approve/on/off work without a running gateway', () => {
    const st = run(['--lang', 'en', 'telegram'], env);
    expect(st.status).toBe(0);
    expect(st.stdout).toContain('Telegram: not set up');
    expect(st.stdout).toContain('Token: missing');
    const bad = run(['--lang', 'en', 'telegram', 'setup', '--token', 'nope', '--no-wait'], env);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('does not look like a bot token');
    const unknown = run(['--lang', 'en', 'telegram', 'approve', '123456'], env);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('No pending request');
    expect(run(['--lang', 'en', 'telegram', 'on'], env).stdout).toContain(
      'channels.telegram.enabled = true',
    );
    expect(run(['config', 'get', 'channels.telegram.enabled'], env).stdout.trim()).toBe('true');
    const doctor = JSON.parse(run(['doctor', '--json'], env).stdout) as {
      checks: Array<{ id: string; status: string }>;
    };
    expect(doctor.checks.find((c) => c.id === 'telegram')?.status).toBe('warn');
    expect(run(['--lang', 'en', 'telegram', 'off'], env).status).toBe(0);
  });
});
