/** Android-shell glue: draft hand-over through the URL and the "is the brain on this phone" check. */
import { describe, expect, it } from 'vitest';
import { isLocalBrain, native, takeDraftFromUrl } from '../src/lib/native.ts';

describe('native bridge helpers', () => {
  it('detects a brain running on the same device', () => {
    expect(isLocalBrain('http://127.0.0.1:18789')).toBe(true);
    expect(isLocalBrain('http://localhost:18789/')).toBe(true);
    expect(isLocalBrain('http://192.168.1.20:18789')).toBe(false);
    expect(isLocalBrain('https://brain.example.com')).toBe(false);
    expect(isLocalBrain(undefined)).toBe(false);
  });

  it('is a no-op outside the app', () => {
    expect(native()).toBeUndefined();
  });

  it('takes ?draft= out of the address exactly once', () => {
    let href = '';
    Object.assign(globalThis, {
      location: {
        search: '?draft=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%20hi&x=1',
        pathname: '/',
        hash: '#a',
      },
      history: {
        replaceState: (_s: unknown, _t: string, url: string) => {
          href = url;
          (globalThis as { location: { search: string } }).location.search = url.includes('?')
            ? url.slice(url.indexOf('?'), url.indexOf('#'))
            : '';
        },
      },
    });
    expect(takeDraftFromUrl()).toBe('مرحبا hi');
    expect(href).toBe('/?x=1#a');
    expect(takeDraftFromUrl()).toBeUndefined();
  });
});
