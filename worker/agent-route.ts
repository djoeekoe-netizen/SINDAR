// Cloudflare Worker route: POST /agent
// يستقبل { messages, tools } ويرجع { message } بصيغة OpenAI-compatible.
// يجرّب Gemini أولاً ثم Groq. كلاهما يدعم tool calling بنفس الصيغة.

export interface Env {
  GEMINI_API_KEY: string;
  GROQ_API_KEY: string;
  // اختياري: غيّر أسماء النماذج بدون تعديل الكود
  GEMINI_MODEL?: string;
  GROQ_MODEL?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function providers(env: Env) {
  return [
    {
      name: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL ?? "gemini-2.5-flash",
    },
    {
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: env.GROQ_API_KEY,
      model: env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    },
  ].filter((p) => !!p.key);
}

export async function handleAgent(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  let body: { messages?: unknown[]; tools?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (!Array.isArray(body.messages)) return json({ error: "messages_required" }, 400);

  const errors: string[] = [];
  for (const p of providers(env)) {
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          messages: body.messages,
          tools: body.tools?.length ? body.tools : undefined,
          tool_choice: body.tools?.length ? "auto" : undefined,
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        errors.push(`${p.name}:${res.status}`);
        continue;
      }
      const data: any = await res.json();
      const message = data?.choices?.[0]?.message;
      if (!message) {
        errors.push(`${p.name}:empty`);
        continue;
      }
      return json({ message, provider: p.name });
    } catch (e) {
      errors.push(`${p.name}:${(e as Error).message}`);
    }
  }
  return json({ error: "all_providers_failed", details: errors }, 502);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
