import { useRef, useState } from "react";
import { runAgent } from "./agent/runAgent";
import type { AgentEvent, Msg } from "./agent/types";

interface Bubble {
  role: "user" | "assistant";
  text: string;
}

interface Pending {
  name: string;
  args: unknown;
  resolve: (ok: boolean) => void;
}

const LABELS: Record<string, string> = {
  list_files: "عرض الملفات",
  group_files_by_type: "تصنيف الملفات",
  create_folder: "إنشاء مجلد",
  move_file: "نقل ملف",
  delete_file: "حذف ملف",
  list_apps: "عرض التطبيقات",
};

function describe(e: AgentEvent): string | null {
  switch (e.type) {
    case "thinking":
      return `🤔 خطوة ${e.step}`;
    case "tool_call":
      return `🔧 ${LABELS[e.name] ?? e.name} ${JSON.stringify(e.args)}`;
    case "tool_result":
      return e.ok ? `✅ ${LABELS[e.name] ?? e.name}` : `⚠️ فشل: ${LABELS[e.name] ?? e.name}`;
    case "denied":
      return `⛔ رفضت: ${LABELS[e.name] ?? e.name}`;
    case "fallback":
      return `📴 السحابة فشلت، نموذج احتياطي`;
    default:
      return null;
  }
}

export default function App() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const history = useRef<Msg[]>([]);
  const abort = useRef<AbortController | null>(null);

  const confirm = (name: string, args: unknown) =>
    new Promise<boolean>((resolve) => setPending({ name, args, resolve }));

  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const onEvent = (e: AgentEvent) => {
    const line = describe(e);
    if (line) setLog((l) => [...l, line].slice(-30));
  };

  const stop = () => {
    abort.current?.abort();
    pending?.resolve(false);
    setPending(null);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setLog([]);
    setBubbles((b) => [...b, { role: "user", text }]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const r = await runAgent(text, {
        history: history.current,
        confirm,
        onEvent,
        signal: abort.current.signal,
      });
      history.current = r.history;
      setBubbles((b) => [...b, { role: "assistant", text: r.text }]);
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      setBubbles((b) => [
        ...b,
        { role: "assistant", text: aborted ? "تم الإيقاف." : `حصل خطأ: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h1 className="text-lg font-bold">SINDAR</h1>
        {busy && (
          <button onClick={stop} className="rounded-lg bg-red-600 px-3 py-1 text-sm font-semibold">
            إيقاف
          </button>
        )}
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {bubbles.length === 0 && (
          <p className="mt-10 text-center text-white/50">
            جرّب: «صنّف ملفات مجلد Download» أو «اعرض ملفات DCIM»
          </p>
        )}
        {bubbles.map((b, i) => (
          <div key={i} className={b.role === "user" ? "flex justify-start" : "flex justify-end"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 ${
                b.role === "user" ? "bg-blue-600" : "bg-white/10"
              }`}
            >
              {b.text}
            </div>
          </div>
        ))}
        {log.length > 0 && (
          <div className="space-y-1 rounded-xl border border-white/10 p-3 text-xs text-white/60" dir="ltr">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </main>

      <footer className="flex gap-2 border-t border-white/10 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="اكتب طلبك..."
          className="flex-1 rounded-xl bg-white/10 px-4 py-3 outline-none"
        />
        <button
          onClick={send}
          disabled={busy}
          className="rounded-xl bg-blue-600 px-5 font-semibold disabled:opacity-50"
        >
          إرسال
        </button>
      </footer>

      {pending && (
        <div className="fixed inset-0 z-10 flex items-end bg-black/70 p-4">
          <div className="w-full rounded-2xl bg-[#161b22] p-5">
            <h2 className="mb-2 text-lg font-bold">
              موافقة: {LABELS[pending.name] ?? pending.name}
            </h2>
            <pre className="mb-4 overflow-x-auto rounded-lg bg-black/40 p-3 text-xs" dir="ltr">
              {JSON.stringify(pending.args, null, 2)}
            </pre>
            <div className="flex gap-3">
              <button onClick={() => answer(true)} className="flex-1 rounded-xl bg-green-600 py-3 font-semibold">
                موافق
              </button>
              <button onClick={() => answer(false)} className="flex-1 rounded-xl bg-white/10 py-3 font-semibold">
                رفض
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
