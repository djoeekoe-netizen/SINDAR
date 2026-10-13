import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../src/doctor/index.js';
import { t } from '../src/i18n/index.js';

let home: string;
beforeEach(() => (home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-doc-'))));
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('doctor', () => {
  it('produces a healthy report on a fresh home (no failures)', async () => {
    const r = await runDoctor({
      home,
      env: { PATH: process.env.PATH },
      probeLocal: false,
      lang: 'en',
    });
    expect(r.summary.fail).toBe(0);
    const ids = r.checks.map((c) => c.id);
    for (const id of ['node', 'platform', 'home', 'config', 'db', 'providers', 'resources'])
      expect(ids).toContain(id);
    expect(r.checks.find((c) => c.id === 'model')?.status).toBe('warn'); // mock model warning
    expect(r.checks.find((c) => c.id === 'providers')?.status).toBe('warn'); // nothing configured
    expect(r.verdict).toMatch(/warning/);
    expect(fs.existsSync(path.join(home, 'sindar.db'))).toBe(true);
  });

  it('uses the config language by default and includes Termux guidance when in Termux', async () => {
    const r = await runDoctor({
      home,
      env: {
        PATH: process.env.PATH,
        TERMUX_VERSION: '0.118.3',
        GROQ_API_KEY: 'gsk_abcdefghijklmnop',
      },
      probeLocal: false,
    });
    expect(r.lang).toBe('ar');
    expect(r.checks.find((c) => c.id === 'termux')).toBeTruthy();
    expect(r.checks.find((c) => c.id === 'providers')?.status).toBe('ok');
    expect(
      r.checks
        .find((c) => c.id === 'termux')
        ?.items?.some((i) => i.text === t('ar', 'doctor.termux.battery')),
    ).toBe(true);
  });

  it('reports a config failure instead of crashing', async () => {
    fs.writeFileSync(path.join(home, 'config.yaml'), 'gateway:\n  port: notaport\n');
    const r = await runDoctor({ home, env: {}, probeLocal: false, lang: 'en' });
    expect(r.summary.fail).toBeGreaterThan(0);
    expect(r.checks.find((c) => c.id === 'config')?.status).toBe('fail');
  });
});

describe('i18n', () => {
  it('interpolates and falls back to english', () => {
    expect(t('en', 'doctor.node.ok', { version: '22.0.0' })).toBe('Node.js v22.0.0');
    expect(t('ar', 'doctor.summary.warn', { n: 2 })).toContain('2');
  });
});
