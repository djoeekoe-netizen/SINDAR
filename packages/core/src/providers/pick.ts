/**
 * Choosing a model when the hard-coded suggestion is gone (providers retire models: Gemini
 * "models/gemini-2.5-flash is no longer available to new users…"). Pure helpers, unit-tested.
 */
import { isChatModelId } from './openai-compat.js';

/** Error text that means "this model id does not exist / was retired", not a transient failure. */
export function isModelUnavailableMessage(text: string): boolean {
  return /no longer available|not found|does not exist|unknown model|model_not_found|decommissioned|has been retired|is not supported|unsupported model|invalid model/i.test(
    text,
  );
}

// Segment-bounded so "ge-mini" is not read as "mini"; small sizes like "8b"/"3b" count as light.
const DOWNRANK =
  /(^|[-_./])(lite|mini|nano|preview|exp|thinking|tts|image|audio|live|embed|vision|guard|\d+b)($|[-_./])/i;

/** Numeric version in an id ("gemini-3.8-flash" → 3.8, "llama-3.3-70b" → 3.3). */
export function modelVersion(id: string): number {
  const m = /(\d+(?:\.\d+)?)/.exec(id.replace(/^.*?[:/]/, ''));
  return m ? Number(m[1]) : 0;
}

/**
 * Best available chat model: the first suggestion the provider still lists, else the newest
 * full-size model in the list (prefers "flash"/"versatile"-style workhorses over lite/preview ids).
 */
export function pickAvailableModel(
  available: string[],
  suggested: string[] = [],
): string | undefined {
  const chat = available.filter(isChatModelId);
  if (chat.length === 0) return undefined;
  const set = new Set(chat);
  for (const s of suggested) if (set.has(s)) return s;
  const score = (id: string): number => {
    let n = modelVersion(id) * 10;
    if (/flash|versatile|instruct|chat/i.test(id)) n += 5;
    if (DOWNRANK.test(id)) n -= 20;
    if (/pro\b/i.test(id)) n -= 2; // free tiers usually exclude the pro line
    return n;
  };
  return chat.toSorted((a, b) => score(b) - score(a))[0];
}
