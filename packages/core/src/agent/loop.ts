import fs from 'node:fs';
import path from 'node:path';
import type { Config, Lang } from '../config/schema.js';
import type { Logger } from '../logger.js';
import type { Db } from '../db/types.js';
import type { SindarPaths } from '../paths.js';
import type { PlatformInfo } from '../platform.js';
import { decide, sessionKey, type PolicyDecision, type PolicyState } from '../policy/index.js';
import type { ModelTarget, ProviderRegistry } from '../providers/registry.js';
import {
  ProviderError,
  type ChatMessage,
  type Content,
  type FinishReason,
  type ToolCall,
  type Usage,
} from '../providers/types.js';
import type { Tool, ToolContext, ToolRegistry, ToolResult } from '../tools/types.js';
import { buildSystemPrompt, estimateTokens } from './context.js';
import { contentToText, type Session, type SessionStore, type StoredMessage } from './sessions.js';
import { MemoryFiles } from '../memory/index.js';
import { SkillStore } from '../skills/index.js';
import { learningSections, reflectSkill } from './learning.js';

export type ApprovalAnswer = 'allow' | 'deny' | 'always';

export interface ApprovalRequest {
  tool: Tool;
  args: unknown;
  decision: PolicyDecision;
  call: ToolCall;
}

export type AgentEvent =
  | { type: 'turn_start'; session: Session; model: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_start'; call: ToolCall; summary: string; decision: PolicyDecision }
  | { type: 'tool_progress'; call: ToolCall; line: string }
  | { type: 'tool_end'; call: ToolCall; result: ToolResult; ms: number }
  | { type: 'tool_denied'; call: ToolCall; summary: string; reason: string }
  | { type: 'usage'; usage: Usage; model: string }
  | { type: 'model_switch'; from: string; to: string; reason: string }
  | { type: 'compress'; beforeTokens: number; afterTokens: number }
  | { type: 'notice'; message: string }
  | { type: 'skill_saved'; name: string; action: 'created' | 'updated' }
  | { type: 'retry_wait'; model: string; seconds: number; attempt: number; reason: string }
  | { type: 'done'; finishReason: FinishReason; text: string; iterations: number }
  | { type: 'error'; error: Error };

export interface AgentRuntime {
  config: Config;
  paths: SindarPaths;
  platform: PlatformInfo;
  env: Record<string, string | undefined>;
  lang: Lang;
  logger: Logger;
  registry: ProviderRegistry;
  tools: ToolRegistry;
  store: SessionStore;
  /** Learning loop services (created from paths/config when omitted). */
  memory?: MemoryFiles;
  skills?: SkillStore;
  /** Database handle — needed by channels (pairing store). */
  db?: Db;
}

export interface TurnOptions {
  session: Session;
  input: string | Content;
  /** Overrides the session/config default model for this turn. */
  modelRef?: string;
  policy: PolicyState;
  cwd?: string;
  onEvent?: (ev: AgentEvent) => void;
  requestApproval?: (req: ApprovalRequest) => Promise<ApprovalAnswer>;
  signal?: AbortSignal;
  /** Extra system prompt sections (skills, nudges…). */
  extraSections?: string[];
}

export interface TurnResult {
  text: string;
  finishReason: FinishReason;
  iterations: number;
  model: string;
  usage: Usage;
  toolCalls: number;
}

const COMPRESS_RATIO = 0.75;
const KEEP_RECENT_MESSAGES = 6;

function toChatMessages(history: StoredMessage[]): ChatMessage[] {
  return history.map(({ role, content, name, toolCalls, toolCallId }) => ({
    role,
    content,
    name,
    toolCalls,
    toolCallId,
  }));
}

function approxTokens(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    n += estimateTokens(contentToText(m.content)) + 4;
    if (m.toolCalls) n += estimateTokens(JSON.stringify(m.toolCalls));
  }
  return n;
}

/** Drop orphaned tool messages / dangling tool calls at the cut point so providers accept the history. */
function sanitize(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const pendingIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool') {
      if (!m.toolCallId || !pendingIds.has(m.toolCallId)) continue;
      pendingIds.delete(m.toolCallId);
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const c of m.toolCalls) pendingIds.add(c.id);
    }
    out.push(m);
  }
  // An assistant message whose tool calls never got results would make strict providers 400.
  while (pendingIds.size) {
    const last = out[out.length - 1];
    if (!last) break;
    if (last.role === 'assistant' && last.toolCalls?.some((c) => pendingIds.has(c.id))) {
      out.pop();
      for (const c of last.toolCalls) pendingIds.delete(c.id);
    } else break;
  }
  return out;
}

export class AgentError extends Error {
  constructor(
    message: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export async function runTurn(rt: AgentRuntime, opts: TurnOptions): Promise<TurnResult> {
  const { store, registry, tools, config } = rt;
  const emit = (ev: AgentEvent) => opts.onEvent?.(ev);
  const session = opts.session;
  const cwd = opts.cwd ?? session.cwd ?? process.cwd();
  const workspace = config.agent.workspace ?? rt.paths.workspace;
  const signal = opts.signal;
  const toolCtx: ToolContext = {
    cwd,
    workspace,
    home: rt.paths.home,
    paths: rt.paths,
    env: rt.env,
    platform: rt.platform,
    lang: rt.lang,
    sessionId: session.id,
    signal,
    logger: rt.logger,
    limits: {
      maxOutputChars: config.agent.maxToolOutputChars,
      timeoutMs: config.agent.toolTimeoutS * 1000,
    },
    saveOverflow: (name, text) => {
      const dir = path.join(rt.paths.logs, 'tool-output');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${name}.txt`);
      fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
      return file;
    },
  };
  const memoryFiles =
    rt.memory ??
    new MemoryFiles(rt.paths, { memory: config.memory.maxChars, user: config.memory.userMaxChars });
  const skillStore =
    rt.skills ?? new SkillStore({ user: rt.paths.skills, extra: config.skills.extraDirs });
  toolCtx.services = {
    memory: memoryFiles,
    skills: skillStore,
    sessions: store,
    skillsMode: config.skills.autoCreate,
  };
  const toolNames = new Set(tools.list().map((t) => t.name));

  const candidates = registry.candidates(opts.modelRef ?? session.model ?? undefined);
  let targetIdx = 0;
  let target: ModelTarget;
  try {
    target = registry.target(candidates[0]!);
  } catch (err) {
    const e = err as Error;
    emit({ type: 'error', error: e });
    throw new AgentError(e.message, e);
  }

  // 1) Persist the user message (and a title on first message).
  const userText = contentToText(opts.input);
  store.append(session.id, { role: 'user', content: opts.input });
  if (!session.title && userText.trim()) {
    const title = userText.trim().replace(/\s+/g, ' ').slice(0, 60);
    store.update(session.id, { title });
    session.title = title;
  }
  if (!session.model) store.update(session.id, { model: target.ref });
  emit({ type: 'turn_start', session, model: target.ref });

  const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  let finalText = '';
  let finishReason: FinishReason = 'stop';
  let iterations = 0;
  let toolCallCount = 0;
  let skillTouched = false;
  const maxIterations = config.agent.maxIterations;
  const toolDefs = tools.definitions();

  const systemPrompt = () =>
    buildSystemPrompt({
      config,
      paths: rt.paths,
      platform: rt.platform,
      lang: rt.lang,
      cwd,
      workspace,
      tools: tools.list(),
      approvalMode: opts.policy.mode,
      extraSections: [
        ...learningSections({
          config,
          memory: memoryFiles,
          skills: skillStore,
          toolNames,
          turnsSinceMemorySave: store.turnsSinceTool(session.id, 'memory'),
          recentSessions: toolNames.has('session_search')
            ? store
                .list({ limit: 8 })
                .filter((s) => s.id !== session.id && s.messageCount > 0)
                .slice(0, 5)
            : undefined,
        }),
        ...(opts.extraSections ?? []),
      ],
    });

  const assemble = (): ChatMessage[] => {
    const fresh = store.get(session.id)!;
    const history = sanitize(
      toChatMessages(store.messages(session.id, { afterSeq: fresh.summaryUpto })),
    );
    const msgs: ChatMessage[] = [{ role: 'system', content: systemPrompt() }];
    if (fresh.summary) {
      msgs.push({
        role: 'system',
        content: `# Earlier conversation (compressed summary)\n\n${fresh.summary}`,
      });
    }
    return [...msgs, ...history];
  };

  const maybeCompress = async (messages: ChatMessage[]): Promise<ChatMessage[]> => {
    const window = registry.contextWindow(target.model);
    const tokens = approxTokens(messages);
    if (tokens < window * COMPRESS_RATIO) return messages;
    const fresh = store.get(session.id)!;
    const all = store.messages(session.id, { afterSeq: fresh.summaryUpto });
    if (all.length <= KEEP_RECENT_MESSAGES + 2) return messages;
    // Cut at a user message boundary so tool call/result pairs stay together.
    let cut = all.length - KEEP_RECENT_MESSAGES;
    while (cut > 0 && all[cut]!.role !== 'user') cut--;
    if (cut <= 0) return messages;
    const old = all.slice(0, cut);
    const transcript = old
      .map(
        (m) =>
          `${m.role}${m.name ? `(${m.name})` : ''}: ${contentToText(m.content).slice(0, 2000)}${m.toolCalls ? ` [tool calls: ${m.toolCalls.map((c) => c.name).join(', ')}]` : ''}`,
      )
      .join('\n');
    const prompt = [
      'Summarize the conversation below for your own future reference. Keep: user goals, decisions, facts learned, file paths touched, open tasks and anything the user asked you to remember. Be concise (max 400 words). Write in the language the user used.',
      fresh.summary ? `Previous summary:\n${fresh.summary}\n` : '',
      `Conversation:\n${transcript}`,
    ].join('\n\n');
    try {
      let summary = '';
      for await (const ev of target.provider.chat(
        { model: target.model, messages: [{ role: 'user', content: prompt }], maxTokens: 1200 },
        signal,
      )) {
        if (ev.type === 'text') summary += ev.delta;
        if (ev.type === 'usage') {
          totalUsage.inputTokens += ev.usage.inputTokens;
          totalUsage.outputTokens += ev.usage.outputTokens;
          store.recordUsage(session.id, target.providerId, target.model, ev.usage);
        }
        if (ev.type === 'error') throw ev.error;
      }
      if (!summary.trim()) return messages;
      store.update(session.id, { summary: summary.trim(), summaryUpto: old[old.length - 1]!.seq });
      const after = assemble();
      emit({ type: 'compress', beforeTokens: tokens, afterTokens: approxTokens(after) });
      return after;
    } catch (err) {
      rt.logger.warn('compression failed', { error: (err as Error).message });
      return messages;
    }
  };

  const MAX_WAITS = 3;
  const MAX_WAIT_MS = 45_000;
  let waits = 0;

  const switchTarget = (reason: string): boolean => {
    while (++targetIdx < candidates.length) {
      try {
        const next = registry.target(candidates[targetIdx]!);
        emit({ type: 'model_switch', from: target.ref, to: next.ref, reason });
        target = next;
        return true;
      } catch (err) {
        rt.logger.warn('fallback unusable', {
          ref: candidates[targetIdx],
          error: (err as Error).message,
        });
      }
    }
    return false;
  };

  const MAX_IDENTICAL_CALLS = 2;
  const repeatCounts = new Map<string, number>();

  // 2) The loop.
  while (iterations < maxIterations) {
    if (signal?.aborted) {
      finishReason = 'cancelled';
      break;
    }
    iterations++;
    let messages = await maybeCompress(assemble());

    let text = '';
    const calls: ToolCall[] = [];
    let turnFinish: FinishReason = 'stop';
    let streamed = false;

    // 2a) Call the model, falling back on retryable failures that happen before any output.
    for (;;) {
      text = '';
      calls.length = 0;
      streamed = false;
      try {
        const req = {
          model: target.model,
          messages,
          tools: toolDefs.length && target.provider.capabilities.tools ? toolDefs : undefined,
          temperature: config.agent.temperature,
        };
        for await (const ev of target.provider.chat(req, signal)) {
          switch (ev.type) {
            case 'text':
              streamed = true;
              text += ev.delta;
              emit(ev);
              break;
            case 'reasoning':
              emit(ev);
              break;
            case 'tool_call':
              calls.push(ev.call);
              break;
            case 'usage':
              totalUsage.inputTokens += ev.usage.inputTokens;
              totalUsage.outputTokens += ev.usage.outputTokens;
              store.recordUsage(session.id, target.providerId, target.model, ev.usage);
              emit({ type: 'usage', usage: ev.usage, model: target.ref });
              break;
            case 'done':
              turnFinish = ev.finishReason;
              break;
            case 'error':
              throw ev.error;
          }
        }
        break;
      } catch (err) {
        if (signal?.aborted) {
          turnFinish = 'cancelled';
          break;
        }
        const e = err instanceof Error ? err : new Error(String(err));
        const retryable = e instanceof ProviderError && e.retryable;
        rt.logger.warn('model call failed', {
          model: target.ref,
          code: (e as ProviderError).code,
          error: e.message,
        });
        // A connection failure (no internet, Termux throttled in the background…) hits every
        // provider alike, so wait for the network first and only then try the fallbacks.
        const isNetwork = (e as ProviderError).code === 'network';
        if (!streamed && !isNetwork && switchTarget(e.message)) {
          // Re-assemble with the new target's context window in mind.
          messages = await maybeCompress(assemble());
          continue;
        }
        // Nothing left to fall back to: for short rate limits / transient errors, wait and retry.
        if (retryable && !streamed && waits < MAX_WAITS) {
          const hinted = e instanceof ProviderError ? e.retryAfterMs : undefined;
          const base = isNetwork ? 5000 : 2000;
          const ms = Math.min(MAX_WAIT_MS, hinted !== undefined ? hinted + 500 : base * 2 ** waits);
          waits++;
          emit({
            type: 'retry_wait',
            model: target.ref,
            seconds: Math.ceil(ms / 1000),
            attempt: waits,
            reason: e.message,
          });
          const aborted = await sleep(ms, signal);
          if (!aborted) continue;
          turnFinish = 'cancelled';
          break;
        }
        if (!streamed && isNetwork && switchTarget(e.message)) {
          messages = await maybeCompress(assemble());
          continue;
        }
        emit({ type: 'error', error: e });
        if (text) store.append(session.id, { role: 'assistant', content: text });
        throw new AgentError(e.message, e);
      }
    }

    if (turnFinish === 'cancelled') {
      if (text) store.append(session.id, { role: 'assistant', content: text });
      finalText = text;
      finishReason = 'cancelled';
      break;
    }

    // 2b) Persist the assistant message.
    store.append(session.id, {
      role: 'assistant',
      content: text || (calls.length ? null : ''),
      toolCalls: calls.length ? calls : undefined,
    });
    finalText = text;

    if (calls.length === 0) {
      finishReason = turnFinish === 'length' ? 'length' : 'stop';
      break;
    }

    // 2c) Execute tool calls sequentially (deterministic, approval-friendly).
    for (const call of calls) {
      if (signal?.aborted) break;
      toolCallCount++;
      const parsed = tools.parseArgs(call);
      if (!parsed.ok) {
        const result: ToolResult = { content: `error: ${parsed.error}`, isError: true };
        emit({
          type: 'tool_start',
          call,
          summary: call.name,
          decision: {
            action: 'deny',
            reason: 'forbidden',
            detail: { risk: 'read' },
            summary: call.name,
          },
        });
        emit({ type: 'tool_end', call, result, ms: 0 });
        store.append(session.id, {
          role: 'tool',
          content: result.content,
          toolCallId: call.id,
          name: call.name,
        });
        continue;
      }
      const { tool, args } = parsed;
      // Guard against loops: the same tool with identical arguments, over and over.
      const callKey = `${tool.name}:${JSON.stringify(args)}`;
      const seen = (repeatCounts.get(callKey) ?? 0) + 1;
      repeatCounts.set(callKey, seen);
      if (seen > MAX_IDENTICAL_CALLS) {
        const content = `error: you already ran ${tool.name} with these exact arguments ${seen - 1} times this turn and got the same result each time. Do not repeat it — use the earlier output (an empty listing means the folder has no visible files), change the arguments, or tell the user what you found.`;
        emit({
          type: 'tool_denied',
          call,
          summary: tool.summarize?.(args) ?? tool.name,
          reason: 'repeat',
        });
        store.append(session.id, { role: 'tool', content, toolCallId: call.id, name: call.name });
        continue;
      }
      const decision = decide(tool, args, toolCtx, opts.policy);
      let allowed = decision.action === 'allow';
      let decidedBy = 'policy';
      if (decision.action === 'deny') {
        const reason = decision.detail.forbidden ?? 'blocked by policy';
        emit({ type: 'tool_denied', call, summary: decision.summary, reason });
        store.recordApproval({
          sessionId: session.id,
          tool: tool.name,
          args,
          risk: decision.detail.risk,
          status: 'forbidden',
          decidedBy: 'policy',
        });
        const content = `error: this action is forbidden by SINDAR's safety rules (${reason}). Do not retry it; explain and propose a safer alternative.`;
        store.append(session.id, { role: 'tool', content, toolCallId: call.id, name: call.name });
        continue;
      }
      if (decision.action === 'ask') {
        const answer = opts.requestApproval
          ? await opts.requestApproval({ tool, args, decision, call })
          : 'deny';
        decidedBy = 'user';
        if (answer === 'always') opts.policy.sessionAllowed.add(sessionKey(tool, decision.detail));
        allowed = answer !== 'deny';
        store.recordApproval({
          sessionId: session.id,
          tool: tool.name,
          args,
          risk: decision.detail.risk,
          status: allowed ? 'allowed' : 'denied',
          decidedBy,
        });
      } else {
        store.recordApproval({
          sessionId: session.id,
          tool: tool.name,
          args,
          risk: decision.detail.risk,
          status: 'auto',
          decidedBy,
        });
      }
      if (!allowed) {
        emit({ type: 'tool_denied', call, summary: decision.summary, reason: 'user' });
        const content =
          'error: the user declined this action. Do not retry it unchanged — ask what they prefer or continue without it.';
        store.append(session.id, { role: 'tool', content, toolCallId: call.id, name: call.name });
        continue;
      }
      emit({ type: 'tool_start', call, summary: decision.summary, decision });
      const started = Date.now();
      const ctxWithProgress: ToolContext = {
        ...toolCtx,
        onProgress: (line) => emit({ type: 'tool_progress', call, line }),
      };
      const result = await tools.execute(tool, args, ctxWithProgress);
      const ms = Date.now() - started;
      emit({ type: 'tool_end', call, result, ms });
      rt.logger.info('tool', { name: tool.name, ms, error: result.isError ?? false });
      if (tool.name === 'skill_manager' && !result.isError) skillTouched = true;
      let content = result.content;
      if (
        toolCallCount === config.skills.reflectAfterToolCalls &&
        config.skills.autoCreate !== 'off' &&
        toolNames.has('skill_manager')
      ) {
        content += `\n\n[SINDAR note: this task has already taken ${toolCallCount} tool calls. ${
          config.skills.autoCreate === 'auto'
            ? 'If the procedure is likely to recur, save it as a skill with skill_manager once the task is done (steps, commands, pitfalls).'
            : 'If the procedure is likely to recur, end your final answer with a one-line offer to save it as a skill — do not create it before the user agrees.'
        }]`;
      }
      store.append(session.id, {
        role: 'tool',
        content,
        toolCallId: call.id,
        name: call.name,
      });
    }
    if (signal?.aborted) {
      finishReason = 'cancelled';
      break;
    }
  }

  if (iterations >= maxIterations && finishReason === 'stop' && !finalText) {
    const note = `Stopped after ${maxIterations} tool iterations (agent.maxIterations). Ask me to continue if needed.`;
    emit({ type: 'notice', message: note });
    store.append(session.id, { role: 'assistant', content: note });
    finalText = note;
    finishReason = 'length';
  }

  // 3) Learning loop: in `auto` mode, distil a reusable skill out of complex successful tasks.
  if (
    config.skills.autoCreate === 'auto' &&
    finishReason === 'stop' &&
    !skillTouched &&
    toolCallCount >= config.skills.reflectAfterToolCalls &&
    toolNames.has('skill_manager') &&
    !signal?.aborted
  ) {
    try {
      const saved = await reflectSkill({
        provider: target.provider,
        model: target.model,
        skills: skillStore,
        transcript: store.transcript(session.id, { maxChars: 6000, includeTools: false }),
        signal,
        onUsage: (usage) => {
          totalUsage.inputTokens += usage.inputTokens;
          totalUsage.outputTokens += usage.outputTokens;
          store.recordUsage(session.id, target.providerId, target.model, usage);
        },
      });
      if (saved) {
        emit({ type: 'skill_saved', name: saved.name, action: saved.action });
        rt.logger.info('skill saved by reflection', saved);
      }
    } catch (err) {
      rt.logger.warn('skill reflection failed', { error: (err as Error).message });
    }
  }

  emit({ type: 'done', finishReason, text: finalText, iterations });
  return {
    text: finalText,
    finishReason,
    iterations,
    model: target.ref,
    usage: totalUsage,
    toolCalls: toolCallCount,
  };
}

/** Resolves true when aborted, false after `ms`. */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(true);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
