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

describe('config editing', () => {
  it('sets values preserving comments, validates, and upserts env vars', async () => {
    const { coerceValue, setConfigValue, upsertEnvVar, readEnvFile, getConfigValue } =
      await import('../src/config/edit.js');
    const file = path.join(home, 'config.yaml');
    fs.writeFileSync(file, '# keep me\nmodel:\n  default: mock:echo # inline\n');
    setConfigValue(file, 'model.default', 'groq:llama-3.3-70b-versatile');
    setConfigValue(file, 'model.fallbacks', ['gemini:gemini-2.5-flash']);
    setConfigValue(file, 'agent.approvalMode', 'yolo');
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('# keep me');
    expect(text).toContain('# inline');
    expect(text).toContain('default: groq:llama-3.3-70b-versatile');
    expect(text).toContain('fallbacks: [ gemini:gemini-2.5-flash ]');
    expect(() => setConfigValue(file, 'agent.approvalMode', 'maybe')).toThrowError(ConfigError);
    expect(fs.readFileSync(file, 'utf8')).toContain('approvalMode: yolo');
    expect(coerceValue('123')).toBe(123);
    expect(coerceValue('true')).toBe(true);
    expect(coerceValue('[a, b]')).toEqual(['a', 'b']);
    expect(coerceValue('groq:llama')).toBe('groq:llama');
    expect(getConfigValue({ a: { b: 1 } }, 'a.b')).toBe(1);

    const env = path.join(home, '.env');
    fs.writeFileSync(env, '# keys\nGROQ_API_KEY=old\nOTHER=1\n');
    upsertEnvVar(env, 'GROQ_API_KEY', 'new-key');
    upsertEnvVar(env, 'GEMINI_API_KEY', 'with space');
    expect(readEnvFile(env)).toEqual({
      GROQ_API_KEY: 'new-key',
      OTHER: '1',
      GEMINI_API_KEY: 'with space',
    });
    expect(fs.readFileSync(env, 'utf8')).toContain('# keys');
    if (process.platform !== 'win32') expect(fs.statSync(env).mode & 0o777).toBe(0o600);
    upsertEnvVar(env, 'OTHER', undefined);
    expect(readEnvFile(env).OTHER).toBeUndefined();
  });
});
