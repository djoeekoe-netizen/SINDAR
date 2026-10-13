import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parse as parseDotenv } from 'dotenv';
import { ConfigSchema, type Config } from './schema.js';
import { ensureHome, getPaths, resolveHome, type SindarPaths } from '../paths.js';
import { expandHome } from '../platform.js';

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedConfig {
  config: Config;
  paths: SindarPaths;
  /** Merged environment: process env wins over `~/.sindar/.env`. */
  env: Env;
  warnings: string[];
  /** Files created on this run (first start). */
  created: string[];
}

export interface LoadConfigOptions {
  home?: string;
  env?: Env;
  /** When false, missing home/config is an error instead of being created. */
  init?: boolean;
}

const ENV_OVERRIDES: Array<{
  env: string;
  apply: (c: Config, v: string, warn: (m: string) => void) => void;
}> = [
  { env: 'SINDAR_MODEL', apply: (c, v) => (c.model.default = v) },
  {
    env: 'SINDAR_LANG',
    apply: (c, v, warn) => {
      if (v === 'ar' || v === 'en') c.ui.language = v;
      else warn(`SINDAR_LANG=${v} ignored (expected ar|en)`);
    },
  },
  {
    env: 'SINDAR_PORT',
    apply: (c, v, warn) => {
      const n = Number.parseInt(v, 10);
      if (Number.isInteger(n) && n > 0 && n < 65536) c.gateway.port = n;
      else warn(`SINDAR_PORT=${v} ignored`);
    },
  },
  { env: 'SINDAR_HOST', apply: (c, v) => (c.gateway.host = v) },
  {
    env: 'SINDAR_LOG_LEVEL',
    apply: (c, v, warn) => {
      if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') c.logging.level = v;
      else warn(`SINDAR_LOG_LEVEL=${v} ignored`);
    },
  },
  {
    env: 'SINDAR_APPROVAL_MODE',
    apply: (c, v, warn) => {
      if (v === 'ask' || v === 'allowlist' || v === 'yolo') c.agent.approvalMode = v;
      else warn(`SINDAR_APPROVAL_MODE=${v} ignored`);
    },
  },
];

function readEnvFile(file: string): Env {
  if (!fs.existsSync(file)) return {};
  try {
    return parseDotenv(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function parseConfigText(text: string, file: string): Config {
  let raw: unknown;
  try {
    raw = text.trim() ? parseYaml(text) : {};
  } catch (err) {
    throw new ConfigError(`Invalid YAML in ${file}: ${(err as Error).message}`, file);
  }
  if (raw === null || raw === undefined) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`Config root must be a mapping in ${file}`, file);
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration in ${file}`, file, issues);
  }
  return result.data;
}

export async function loadConfig(opts: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const processEnv = opts.env ?? process.env;
  const home = opts.home ? path.resolve(expandHome(opts.home)) : resolveHome(processEnv);
  const paths = getPaths(home);
  const warnings: string[] = [];
  let created: string[] = [];

  if (opts.init !== false) {
    created = ensureHome(paths).created;
  } else if (!fs.existsSync(paths.config)) {
    throw new ConfigError(`Config not found: ${paths.config}`, paths.config);
  }

  const config = parseConfigText(fs.readFileSync(paths.config, 'utf8'), paths.config);

  const fileEnv = readEnvFile(paths.env);
  const env: Env = { ...fileEnv, ...processEnv };

  for (const o of ENV_OVERRIDES) {
    const v = env[o.env];
    if (v !== undefined && v !== '') o.apply(config, v, (m) => warnings.push(m));
  }

  config.agent.workspace = config.agent.workspace
    ? path.resolve(expandHome(config.agent.workspace))
    : paths.workspace;

  return { config, paths, env, warnings, created };
}
