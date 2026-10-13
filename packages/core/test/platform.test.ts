import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  commandExists,
  detectOs,
  detectPlatform,
  expandHome,
  formatBytes,
  isTermuxEnv,
  resolveShell,
} from '../src/platform.js';

describe('platform', () => {
  it('detects Termux from TERMUX_VERSION or PREFIX', () => {
    expect(isTermuxEnv({ TERMUX_VERSION: '0.118.3' })).toBe(true);
    expect(isTermuxEnv({ PREFIX: '/data/data/com.termux/files/usr' })).toBe(true);
    expect(isTermuxEnv({ PATH: '/usr/bin' })).toBe(process.platform === 'android');
  });

  it('reports android when in Termux', () => {
    expect(detectOs({ TERMUX_VERSION: '1' })).toBe('android');
    const p = detectPlatform({
      TERMUX_VERSION: '0.118.3',
      PREFIX: '/data/data/com.termux/files/usr',
      PATH: process.env.PATH,
    });
    expect(p.isTermux).toBe(true);
    expect(p.termuxVersion).toBe('0.118.3');
    expect(p.prefix).toBe('/data/data/com.termux/files/usr');
  });

  it('never hardcodes a shell that does not exist', () => {
    const { shell, args } = resolveShell({ ...process.env, SHELL: '/definitely/not/here' });
    expect(shell).toBeTruthy();
    expect(args.length).toBeGreaterThan(0);
    if (process.platform !== 'win32') expect(shell === 'sh' || path.isAbsolute(shell)).toBe(true);
  });

  it('finds executables on PATH without spawning', () => {
    expect(commandExists('node')).toBeTruthy();
    expect(commandExists('definitely-not-a-real-binary-xyz')).toBeUndefined();
  });

  it('expands ~ and formats bytes', () => {
    expect(expandHome('~/x', '/home/u')).toBe(path.join('/home/u', 'x'));
    expect(expandHome('/abs', '/home/u')).toBe('/abs');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(8 * 1024 ** 3)).toBe('8.0 GB');
  });
});
