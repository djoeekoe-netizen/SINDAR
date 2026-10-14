import type { ChatMessage } from '../providers/types.js';
import { contentToText } from './sessions.js';
import { estimateTokens } from './context.js';

/**
 * Keep one request under a token budget without touching what is stored.
 *
 * Free tiers (Groq: 6–12k tokens per request) are far smaller than the models' context
 * windows, and a single fetched web page in Arabic can be 8k tokens on its own. So before
 * every call we shrink the *copy* of the history we send, cheapest loss first:
 *   1. old tool outputs (everything but the most recent ones) → short stubs
 *   2. the biggest remaining tool output → cut in half, repeatedly, down to a floor
 *   3. the oldest messages (whole user→assistant rounds) → dropped
 * The stored session stays intact, so a bigger model later still sees everything.
 */

export interface FitOptions {
  /** Token estimator (defaults to estimateTokens; the loop passes a calibrated one). */
  estimate?: (text: string) => number;
  /** Tool outputs newer than this many tool messages are "recent" and only trimmed in step 2. */
  keepRecentTools?: number;
  /** Characters kept from a stubbed old tool output. */
  stubChars?: number;
  /** Never cut a recent tool output below this many characters. */
  minToolChars?: number;
}

export interface FitResult {
  messages: ChatMessage[];
  tokens: number;
  /** Which steps changed something (empty when the request already fitted). */
  actions: Array<'stub_old_tools' | 'cut_tool' | 'drop_oldest'>;
}

const OLD_STUB = (kept: string, total: number) =>
  `${kept}\n…[older tool output trimmed (${total} chars); call the tool again if you still need it]`;

const CUT_NOTE = (shown: number, total: number) =>
  `\n…[trimmed to fit the model's request limit: showing ${shown} of ${total} chars. Ask for the next part (web_fetch offset=${shown}, read_file line ranges) or work with this part]`;

export function messageTokens(m: ChatMessage, estimate = estimateTokens): number {
  let n = estimate(contentToText(m.content)) + 4;
  if (m.toolCalls) n += estimate(JSON.stringify(m.toolCalls));
  return n;
}

export function totalTokens(messages: ChatMessage[], estimate = estimateTokens): number {
  let n = 0;
  for (const m of messages) n += messageTokens(m, estimate);
  return n;
}

function textLength(m: ChatMessage): number {
  return contentToText(m.content).length;
}

function withText(m: ChatMessage, text: string): ChatMessage {
  return { ...m, content: text };
}

export function fitToBudget(
  input: ChatMessage[],
  budget: number,
  opts: FitOptions = {},
): FitResult {
  const estimate = opts.estimate ?? estimateTokens;
  const keepRecent = opts.keepRecentTools ?? 2;
  const stubChars = opts.stubChars ?? 400;
  const minToolChars = opts.minToolChars ?? 1_500;
  const actions: FitResult['actions'] = [];
  let messages = input.slice();
  let tokens = totalTokens(messages, estimate);
  if (tokens <= budget) return { messages, tokens, actions };

  // 1) Stub every tool output except the most recent `keepRecent` ones.
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  const oldTools = toolIdx.slice(0, Math.max(0, toolIdx.length - keepRecent));
  let changed = false;
  for (const i of oldTools) {
    const m = messages[i]!;
    const text = contentToText(m.content);
    if (text.length <= stubChars + 80) continue;
    messages[i] = withText(m, OLD_STUB(text.slice(0, stubChars), text.length));
    changed = true;
  }
  if (changed) {
    actions.push('stub_old_tools');
    tokens = totalTokens(messages, estimate);
    if (tokens <= budget) return { messages, tokens, actions };
  }

  // 2) Halve the largest tool output until everything fits or they are all small.
  for (let guard = 0; guard < 40 && tokens > budget; guard++) {
    let best = -1;
    let bestLen = minToolChars;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role !== 'tool') continue;
      const len = textLength(m);
      if (len > bestLen) {
        best = i;
        bestLen = len;
      }
    }
    if (best < 0) break;
    const m = messages[best]!;
    const text = contentToText(m.content);
    // Strip a previous cut note so the shown/total numbers stay honest.
    const noteAt = text.indexOf('\n…[trimmed to fit');
    const original = noteAt >= 0 ? text.slice(0, noteAt) : text;
    const totalMatch = /showing \d+ of (\d+) chars/.exec(text);
    const total = totalMatch ? Number.parseInt(totalMatch[1]!, 10) : original.length;
    const keep = Math.max(minToolChars, Math.floor(original.length / 2));
    if (keep >= original.length) break;
    messages[best] = withText(m, original.slice(0, keep) + CUT_NOTE(keep, total));
    if (!actions.includes('cut_tool')) actions.push('cut_tool');
    tokens = totalTokens(messages, estimate);
  }
  if (tokens <= budget) return { messages, tokens, actions };

  // 3) Drop the oldest rounds (keep system messages and at least the last user turn).
  const firstHistory = messages.findIndex((m) => m.role !== 'system');
  if (firstHistory >= 0) {
    const system = messages.slice(0, firstHistory);
    let history = messages.slice(firstHistory);
    let dropped = false;
    while (tokens > budget) {
      const roles = history.map((m) => m.role);
      const lastUser = roles.lastIndexOf('user');
      // Cut at the next user message so assistant/tool pairs stay intact; never past the last user turn.
      const next = roles.findIndex((r, i) => i > 0 && r === 'user');
      if (next < 0 || next > lastUser) break;
      history = history.slice(next);
      dropped = true;
      messages = [...system, ...history];
      tokens = totalTokens(messages, estimate);
    }
    if (dropped) {
      actions.push('drop_oldest');
      messages = [
        ...system,
        { role: 'system', content: '(Earlier messages were omitted to fit the model limit.)' },
        ...history,
      ];
      tokens = totalTokens(messages, estimate);
    }
  }
  return { messages, tokens, actions };
}
