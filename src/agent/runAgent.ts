import { toolSchemas, tools as defaultTools } from "./tools";
import type { AgentEvent, Msg, ToolDef } from "./types";

// عدّل الرابط إلى رابط الـ Worker عندك
const WORKER_URL = import.meta.env.VITE_WORKER_URL as string;

const SYSTEM_PROMPT = `أنت مساعد شخصي يعمل على جوال أندرويد للمستخدم، ويتحدث العربية.
- استخدم الأدوات المتاحة عند الحاجة، وابدأ بالقراءة قبل أي تعديل.
- لا تحذف أو تنقل شيئاً قبل أن تعرض على المستخدم ما ستفعله بوضوح.
- نفّذ خطوة واحدة ثم راجع نتيجتها قبل التالية.
- إذا فشلت أداة، اشرح السبب ولا تخترع نتيجة.
- أجب باختصار ووضوح.`;

export interface RunOptions {
  history?: Msg[];
  tools?: ToolDef[];
  maxSteps?: number;
  /** يُستدعى قبل أي أداة risky. ارجع true للموافقة */
  confirm: (name: string, args: unknown) => Promise<boolean>;
  /** سجل الأفعال للواجهة */
  onEvent?: (e: AgentEvent) => void;
  /** المرحلة 4: نموذج محلي احتياطي عند فشل السحابة */
  localModel?: (messages: Msg[], tools: ReturnType<typeof toolSchemas>) => Promise<Msg>;
  signal?: AbortSignal;
}

async function callCloud(messages: Msg[], schemas: ReturnType<typeof toolSchemas>, signal?: AbortSignal): Promise<Msg> {
  const res = await fetch(`${WORKER_URL}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools: schemas }),
    signal,
  });
  if (!res.ok) throw new Error(`cloud ${res.status}`);
  const data = await res.json();
  return data.message as Msg;
}

function truncate(v: unknown, max = 6000): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…[مقتطع]" : s;
}

export async function runAgent(userText: string, opts: RunOptions): Promise<{ text: string; history: Msg[] }> {
  const tools = opts.tools ?? defaultTools;
  const schemas = toolSchemas(tools);
  const emit = opts.onEvent ?? (() => {});
  const maxSteps = opts.maxSteps ?? 8;

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(opts.history ?? []).filter((m) => m.role !== "system"),
    { role: "user", content: userText },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    emit({ type: "thinking", step });

    let reply: Msg;
    try {
      reply = await callCloud(messages, schemas, opts.signal);
    } catch (e) {
      if (!opts.localModel) throw e;
      emit({ type: "fallback", reason: (e as Error).message });
      reply = await opts.localModel(messages, schemas);
    }

    messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.tool_calls });

    if (!reply.tool_calls?.length) {
      const text = reply.content ?? "";
      emit({ type: "final", text });
      return { text, history: messages.slice(1) };
    }

    for (const call of reply.tool_calls) {
      const tool = tools.find((t) => t.name === call.function.name);
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* يبقى {} */
      }

      let result: unknown;
      let ok = true;

      if (!tool) {
        ok = false;
        result = { error: `أداة غير موجودة: ${call.function.name}` };
      } else {
        emit({ type: "tool_call", name: tool.name, args, risky: !!tool.risky });
        if (tool.risky && !(await opts.confirm(tool.name, args))) {
          emit({ type: "denied", name: tool.name });
          result = { error: "رفض المستخدم هذا الإجراء" };
          ok = false;
        } else {
          try {
            result = await tool.run(args);
          } catch (e) {
            ok = false;
            result = { error: (e as Error).message };
          }
        }
        emit({ type: "tool_result", name: tool.name, ok, result });
      }

      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: truncate(result) });
    }
  }

  const text = "وصلت للحد الأقصى من الخطوات دون إنهاء المهمة. قل لي أكمل أو غيّر الطلب.";
  emit({ type: "final", text });
  return { text, history: messages.slice(1) };
}
