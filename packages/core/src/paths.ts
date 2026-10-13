import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandHome } from './platform.js';

export interface SindarPaths {
  home: string;
  config: string;
  env: string;
  db: string;
  soul: string;
  user: string;
  memory: string;
  skills: string;
  workspace: string;
  logs: string;
  backups: string;
}

/** `SINDAR_HOME` overrides the default `~/.sindar`. */
export function resolveHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.SINDAR_HOME;
  if (fromEnv && fromEnv.trim()) return path.resolve(expandHome(fromEnv.trim()));
  return path.join(os.homedir(), '.sindar');
}

export function getPaths(home: string = resolveHome()): SindarPaths {
  return {
    home,
    config: path.join(home, 'config.yaml'),
    env: path.join(home, '.env'),
    db: path.join(home, 'sindar.db'),
    soul: path.join(home, 'SOUL.md'),
    user: path.join(home, 'USER.md'),
    memory: path.join(home, 'MEMORY.md'),
    skills: path.join(home, 'skills'),
    workspace: path.join(home, 'workspace'),
    logs: path.join(home, 'logs'),
    backups: path.join(home, 'backups'),
  };
}

export const DEFAULT_CONFIG_YAML = `# ============================================================
#  SINDAR — ملف الإعدادات  (المفاتيح السرية في ملف .env بجانبه)
#  SINDAR configuration (secrets live in the sibling .env file)
# ============================================================
version: 1

model:
  # الصيغة: provider:model  — مثال: groq:llama-3.3-70b-versatile | ollama:qwen3:8b
  # يُضبط تلقائياً عبر: sindar onboard
  default: mock:echo
  fallbacks: []

providers: {}
  # أمثلة / examples:
  # ollama:
  #   baseUrl: http://127.0.0.1:11434/v1
  # custom:
  #   type: openai-compat
  #   baseUrl: https://my-server.example/v1
  #   apiKeyEnv: MY_KEY

agent:
  approvalMode: ask        # ask | allowlist | yolo
  maxIterations: 50

gateway:
  host: 127.0.0.1
  port: 18789

ui:
  language: ar             # ar | en
  theme: dark              # dark | light | system

logging:
  level: info              # debug | info | warn | error
  file: true
`;

export const DEFAULT_ENV_FILE = `# مفاتيح المزودين — اختياري. انظر .env.example في المستودع للقائمة الكاملة.
# Provider API keys — optional. See .env.example for the full list.
# GROQ_API_KEY=
# GEMINI_API_KEY=
# OPENROUTER_API_KEY=
`;

export interface EnsureHomeResult {
  created: string[];
}

/** Create `~/.sindar` with its default layout. Idempotent and non-destructive. */
export function ensureHome(paths: SindarPaths): EnsureHomeResult {
  const created: string[] = [];
  const mkdir = (p: string) => {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true, mode: 0o700 });
      created.push(p);
    }
  };
  mkdir(paths.home);
  mkdir(paths.skills);
  mkdir(paths.workspace);
  mkdir(paths.logs);
  mkdir(paths.backups);

  if (!fs.existsSync(paths.config)) {
    fs.writeFileSync(paths.config, DEFAULT_CONFIG_YAML, { encoding: 'utf8', mode: 0o600 });
    created.push(paths.config);
  }
  if (!fs.existsSync(paths.env)) {
    fs.writeFileSync(paths.env, DEFAULT_ENV_FILE, { encoding: 'utf8', mode: 0o600 });
    created.push(paths.env);
  }
  return { created };
}

export function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
