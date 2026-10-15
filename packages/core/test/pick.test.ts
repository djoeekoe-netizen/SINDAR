import { describe, expect, it } from 'vitest';
import {
  isModelUnavailableMessage,
  modelVersion,
  pickAvailableModel,
} from '../src/providers/pick.js';

describe('picking a live model when the suggested one was retired', () => {
  it('recognises "retired model" errors', () => {
    expect(
      isModelUnavailableMessage(
        'gemini: HTTP 404 — This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash',
      ),
    ).toBe(true);
    expect(
      isModelUnavailableMessage('The model `foo` does not exist or you do not have access'),
    ).toBe(true);
    expect(isModelUnavailableMessage('HTTP 429 rate limit')).toBe(false);
    expect(isModelUnavailableMessage('fetch failed')).toBe(false);
  });

  it('prefers a still-listed suggestion, else the newest full-size flash/versatile model', () => {
    const gemini = [
      'gemini-2.0-flash-lite',
      'gemini-3.8-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.8-pro',
      'gemini-3.8-flash-preview-tts',
      'gemini-embedding-001',
      'imagen-4',
    ];
    expect(pickAvailableModel(gemini, ['gemini-2.5-flash', 'gemini-3.8-flash'])).toBe(
      'gemini-3.8-flash',
    );
    expect(pickAvailableModel(gemini, ['gemini-2.5-flash'])).toBe('gemini-3.8-flash');
    expect(
      pickAvailableModel(
        gemini.filter((m) => m !== 'gemini-3.8-flash'),
        [],
      ),
    ).toBe('gemini-3.8-pro');
    expect(
      pickAvailableModel(
        ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'whisper-large-v3'],
        [],
      ),
    ).toBe('llama-3.3-70b-versatile');
    expect(pickAvailableModel(['whisper-large-v3', 'text-embedding-3'], ['x'])).toBeUndefined();
    expect(modelVersion('gemini-3.8-flash')).toBe(3.8);
    expect(modelVersion('openai/gpt-oss-120b')).toBe(120);
    expect(modelVersion('no-digits')).toBe(0);
  });
});
