export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Msg {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema للمعاملات */
  parameters: Record<string, unknown>;
  /** إجراء حساس: يحتاج موافقة المستخدم قبل التنفيذ */
  risky?: boolean;
  run: (args: any) => Promise<unknown>;
}

export type AgentEvent =
  | { type: "thinking"; step: number }
  | { type: "tool_call"; name: string; args: unknown; risky: boolean }
  | { type: "tool_result"; name: string; ok: boolean; result: unknown }
  | { type: "denied"; name: string }
  | { type: "final"; text: string }
  | { type: "fallback"; reason: string };
