import type {
  ApprovalAnswer,
  ApprovalDTO,
  HealthDTO,
  MessageDTO,
  ModelsDTO,
  PublicConfigDTO,
  SessionDTO,
} from '../../../gateway/src/protocol.ts';

export interface Connection {
  /** Gateway base URL without trailing slash, e.g. http://127.0.0.1:18789 */
  url: string;
  token: string;
}

const STORAGE_KEY = 'sindar.connection';

export function loadConnection(): Connection | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const c = JSON.parse(raw) as Connection;
    return c?.url && c?.token ? c : undefined;
  } catch {
    return undefined;
  }
}

export function saveConnection(c: Connection | undefined): void {
  if (!c) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!u) return location.origin;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class Api {
  constructor(public readonly conn: Connection) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.conn.url}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.conn.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(msg, res.status);
    }
    return (await res.json()) as T;
  }

  static async health(url: string, timeoutMs = 4000): Promise<HealthDTO> {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new ApiError(`health ${res.status}`, res.status);
    return (await res.json()) as HealthDTO;
  }

  me() {
    return this.req<{ ok: true; config: PublicConfigDTO }>('/api/me');
  }
  config() {
    return this.req<PublicConfigDTO>('/api/config');
  }
  setConfig(patch: Record<string, unknown>) {
    return this.req<{ ok: true; config: PublicConfigDTO }>('/api/config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }
  models() {
    return this.req<ModelsDTO>('/api/models');
  }
  providerModels(provider: string) {
    return this.req<{ provider: string; models: string[] }>(
      `/api/models/${encodeURIComponent(provider)}`,
    );
  }
  sessions(limit = 100) {
    return this.req<{ sessions: SessionDTO[] }>(`/api/sessions?limit=${limit}`);
  }
  createSession(input: { model?: string; cwd?: string } = {}) {
    return this.req<{ session: SessionDTO }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  messages(id: string) {
    return this.req<{ session: SessionDTO; messages: MessageDTO[] }>(
      `/api/sessions/${encodeURIComponent(id)}/messages`,
    );
  }
  deleteSession(id: string) {
    return this.req<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  setSessionModel(id: string, model: string | null) {
    return this.req<{ session: SessionDTO }>(`/api/sessions/${encodeURIComponent(id)}/model`, {
      method: 'PUT',
      body: JSON.stringify({ model }),
    });
  }
  cancel(id: string) {
    return this.req<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
  }
  undo(id: string) {
    return this.req<{ ok: boolean; removed: string | null }>(
      `/api/sessions/${encodeURIComponent(id)}/undo`,
      { method: 'POST' },
    );
  }
  approvals() {
    return this.req<{ pending: ApprovalDTO[] }>('/api/approvals');
  }
  answer(id: string, answer: ApprovalAnswer) {
    return this.req<{ ok: true }>(`/api/approvals/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    });
  }
}
