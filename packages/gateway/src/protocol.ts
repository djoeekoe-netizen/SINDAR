/**
 * Wire protocol shared by the gateway and its clients (web UI, apps).
 * Everything here is JSON-safe. Keep it small and stable: clients may lag behind.
 */

export type ApprovalAnswer = 'allow' | 'always' | 'deny';

export interface SessionDTO {
  id: string;
  title: string | null;
  channel: string;
  model: string | null;
  cwd: string | null;
  approvalMode: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  lastMessage?: string | null;
  /** True while a turn is running for this session. */
  running?: boolean;
}

export interface ToolCallDTO {
  id: string;
  name: string;
  /** Raw JSON string of the arguments. */
  arguments: string;
}

export interface MessageDTO {
  seq: number;
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  text: string;
  name?: string;
  toolCalls?: ToolCallDTO[];
  toolCallId?: string;
  createdAt: number;
}

export interface ApprovalDTO {
  id: string;
  sessionId: string;
  turnId: string;
  tool: string;
  /** Human summary, e.g. the shell command or the file path. */
  summary: string;
  risk: string;
  reason: string;
  /** Pretty-printed arguments (truncated). */
  args: string;
  createdAt: number;
  /** Filled once answered. */
  answer?: ApprovalAnswer;
}

export interface UsageDTO {
  inputTokens: number;
  outputTokens: number;
}

export interface FileRefDTO {
  path: string;
  name: string;
  bytes?: number;
  mime?: string;
}

/** Agent events as seen by clients (mirrors @sindar/core AgentEvent, serialised). */
export type EventDTO =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | {
      type: 'tool_start';
      call: ToolCallDTO;
      summary: string;
      risk: string;
      reason: string;
    }
  | { type: 'tool_progress'; callId: string; line: string }
  | {
      type: 'tool_end';
      callId: string;
      name: string;
      content: string;
      isError: boolean;
      ms: number;
      truncated: boolean;
      /** Files the tool produced (PDFs, written files…) — the UI offers them as downloads. */
      files?: FileRefDTO[];
    }
  | { type: 'tool_denied'; call: ToolCallDTO; summary: string; reason: string }
  | { type: 'usage'; usage: UsageDTO; model: string }
  | { type: 'model_switch'; from: string; to: string; reason: string }
  | { type: 'compress'; beforeTokens: number; afterTokens: number }
  | { type: 'notice'; message: string }
  | { type: 'skill_saved'; name: string; action: 'created' | 'updated' }
  | { type: 'retry_wait'; model: string; seconds: number; attempt: number; reason: string }
  | { type: 'done'; finishReason: string; text: string; iterations: number }
  | { type: 'error'; message: string; code?: string };

export interface PublicConfigDTO {
  language: 'ar' | 'en';
  theme: 'dark' | 'light' | 'system';
  model: { default: string; fallbacks: string[] };
  approvalMode: 'ask' | 'allowlist' | 'yolo';
  skillsMode: 'ask' | 'auto' | 'off';
  memoryNudgeEvery: number;
  workspace: string;
  home: string;
  platform: { os: string; isTermux: boolean; arch: string; nodeVersion: string };
  version: string;
  build: string;
}

export interface ProviderDTO {
  id: string;
  name: string;
  kind: string;
  configured: boolean;
  enabled: boolean;
  free: string;
  signupUrl?: string;
  suggested: string[];
  notes?: string;
}

export interface ModelsDTO {
  default: string;
  fallbacks: string[];
  providers: ProviderDTO[];
}

export interface HealthDTO {
  ok: true;
  name: 'sindar';
  version: string;
  build: string;
  uptimeS: number;
  model: string;
  sessions: number;
  running: number;
  pending: number;
  platform: { os: string; isTermux: boolean };
}

/** Client → gateway (WebSocket). */
export type ClientMessage =
  | {
      type: 'send';
      /** Omit to start a new session. */
      sessionId?: string;
      text: string;
      model?: string;
      cwd?: string;
      /** Echoed back in `turn_start` so the client can match optimistic UI. */
      clientRef?: string;
    }
  | { type: 'cancel'; sessionId: string }
  | { type: 'approve'; id: string; answer: ApprovalAnswer }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'ping' };

/** Gateway → client (WebSocket). */
export type ServerMessage =
  | {
      type: 'hello';
      version: string;
      build: string;
      config: PublicConfigDTO;
      pending: ApprovalDTO[];
      running: string[];
    }
  | {
      type: 'turn_start';
      sessionId: string;
      turnId: string;
      session: SessionDTO;
      model: string;
      clientRef?: string;
      /** The user message as stored (so other clients can render it). */
      text: string;
    }
  | {
      type: 'event';
      sessionId: string;
      turnId: string;
      /** 1-based position inside the turn; lets clients drop duplicates after a reconnect. */
      seq?: number;
      event: EventDTO;
    }
  | { type: 'approval'; approval: ApprovalDTO }
  | { type: 'approval_resolved'; id: string; answer: ApprovalAnswer }
  | {
      type: 'turn_end';
      sessionId: string;
      turnId: string;
      ok: boolean;
      finishReason?: string;
      text?: string;
      error?: { message: string; code?: string };
      usage?: UsageDTO;
    }
  | { type: 'session'; action: 'created' | 'updated' | 'deleted'; session: SessionDTO }
  | { type: 'config'; config: PublicConfigDTO }
  | { type: 'pong' }
  | { type: 'error'; message: string; ref?: string };

/* ---- learning loop (M3) ---- */

export interface MemoryFileDTO {
  target: 'memory' | 'user' | 'soul';
  content: string;
  chars: number;
  /** 0 = unlimited (SOUL.md). */
  limit: number;
  entries: number;
  path: string;
}

export interface SkillDTO {
  name: string;
  description: string;
  version: string;
  tags: string[];
  source: 'bundled' | 'user' | 'installed' | 'extra';
  chars: number;
  updatedAt: number;
  origin?: string;
  /** Only present on GET /api/skills/:name. */
  body?: string;
  raw?: string;
  files?: string[];
  path?: string;
}

export interface SearchHitDTO {
  seq: number;
  role: string;
  createdAt: number;
  snippet: string;
}

export interface SearchResultDTO {
  session: SessionDTO;
  hits: SearchHitDTO[];
}

export interface ScanWarningDTO {
  level: 'danger' | 'warn';
  file: string;
  line: number;
  pattern: string;
  text: string;
}
