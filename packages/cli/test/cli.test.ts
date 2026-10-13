import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarballUrl } from '../src/commands/update.js';

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
  });
});

describe.skipIf(!hasBuild)('built binary', () => {
  it('prints the version', () => {
    const r = run(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+/);
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
});
