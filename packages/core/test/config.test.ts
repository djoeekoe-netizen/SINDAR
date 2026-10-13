import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, loadConfig, parseConfigText } from '../src/config/load.js';
import { getPaths, ensureHome } from '../src/paths.js';

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-cfg-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('config', () => {
  it('creates the home layout on first load', async () => {
    const loaded = await loadConfig({ home, env: {} });
    const p = getPaths(home);
    for (const f of [p.config, p.env, p.skills, p.workspace, p.logs, p.backups])
      expect(fs.existsSync(f)).toBe(true);
    expect(loaded.created.length).toBeGreaterThan(0);
    expect(loaded.config.model.default).toBe('mock:echo');
    expect(loaded.config.gateway.port).toBe(18789);
    expect(loaded.config.ui.language).toBe('ar');
    expect(loaded.config.agent.workspace).toBe(p.workspace);
    // second load creates nothing
    const again = await loadConfig({ home, env: {} });
    expect(again.created).toEqual([]);
  });

  it('applies defaults for partially specified sections', () => {
    const c = parseConfigText(
      'model:\n  default: groq:llama-3.3-70b-versatile\nui:\n  theme: light\n',
      'x.yaml',
    );
    expect(c.model.default).toBe('groq:llama-3.3-70b-versatile');
    expect(c.model.fallbacks).toEqual([]);
    expect(c.ui.theme).toBe('light');
    expect(c.ui.language).toBe('ar');
    expect(c.agent.approvalMode).toBe('ask');
  });

  it('rejects invalid values with readable issues', () => {
    expect(() => parseConfigText('gateway:\n  port: 99999\n', 'x.yaml')).toThrowError(ConfigError);
    try {
      parseConfigText('agent:\n  approvalMode: sometimes\n', 'x.yaml');
    } catch (e) {
      expect((e as ConfigError).issues[0]).toMatch(/agent\.approvalMode/);
    }
    expect(() => parseConfigText('- a\n- b\n', 'x.yaml')).toThrowError(/mapping/);
    expect(() => parseConfigText('a: [unclosed', 'x.yaml')).toThrowError(/Invalid YAML/);
  });

  it('merges .env file with process env (process env wins) and applies SINDAR_* overrides', async () => {
    ensureHome(getPaths(home));
    fs.writeFileSync(path.join(home, '.env'), 'GROQ_API_KEY=from-file\nOTHER=file\n');
    const loaded = await loadConfig({
      home,
      env: {
        GROQ_API_KEY: 'from-process',
        SINDAR_MODEL: 'groq:x',
        SINDAR_LANG: 'en',
        SINDAR_PORT: '1234',
        SINDAR_LOG_LEVEL: 'loud',
      },
    });
    expect(loaded.env.GROQ_API_KEY).toBe('from-process');
    expect(loaded.env.OTHER).toBe('file');
    expect(loaded.config.model.default).toBe('groq:x');
    expect(loaded.config.ui.language).toBe('en');
    expect(loaded.config.gateway.port).toBe(1234);
    expect(loaded.warnings.some((w) => w.includes('SINDAR_LOG_LEVEL'))).toBe(true);
  });

  it('respects SINDAR_HOME with ~ expansion', async () => {
    const loaded = await loadConfig({ env: { SINDAR_HOME: home } });
    expect(loaded.paths.home).toBe(path.resolve(home));
  });
});
