import { describe, expect, it } from 'vitest';
import { collectSecretValues, maskKey, redactString, redactValue } from '../src/redact.js';
import { createLogger } from '../src/logger.js';

describe('redact', () => {
  it('collects secret-looking env values and scrubs them from strings and objects', () => {
    const secrets = collectSecretValues({
      GROQ_API_KEY: 'gsk_abcdefghijklmnop',
      HOME: '/home/u',
      SHORT_TOKEN: 'abc',
    });
    expect(secrets).toEqual(['gsk_abcdefghijklmnop']);
    expect(redactString('key=gsk_abcdefghijklmnop ok', secrets)).toBe('key=*** ok');
    expect(redactString('Authorization: Bearer abcdefghijklmnopqrstuvwxyz', [])).toBe(
      'Authorization: Bearer ***',
    );
    expect(redactString('token sk-ant-api03-abcdefghijklmnopqrstuvwxyz', [])).toContain('***');
    const obj = redactValue(
      {
        apiKey: 'xxxxxxxxxxxx',
        nested: { password: 'p', note: 'uses gsk_abcdefghijklmnop' },
        list: ['gsk_abcdefghijklmnop'],
      },
      secrets,
    ) as Record<string, unknown>;
    expect(obj.apiKey).toBe('***');
    expect((obj.nested as Record<string, unknown>).password).toBe('***');
    expect((obj.nested as Record<string, unknown>).note).toBe('uses ***');
    expect(obj.list).toEqual(['***']);
    expect(maskKey('gsk_abcdefghijklmnop')).toBe('gsk_…mnop');
    expect(maskKey('short')).toBe('***');
  });
});

describe('logger', () => {
  it('filters by level, redacts, and supports child bindings', () => {
    const lines: string[] = [];
    const log = createLogger({
      level: 'info',
      secrets: ['supersecretvalue'],
      write: (l) => lines.push(l),
    });
    log.debug('hidden');
    log.info('hello supersecretvalue', { token: 'supersecretvalue', ok: 1 });
    log.child({ session: 's1' }).warn('child');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first.msg).toBe('hello ***');
    expect(first.data.token).toBe('***');
    expect(first.data.ok).toBe(1);
    const second = JSON.parse(lines[1]!);
    expect(second.session).toBe('s1');
    expect(second.level).toBe('warn');
  });
});
