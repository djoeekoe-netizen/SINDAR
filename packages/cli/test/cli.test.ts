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
