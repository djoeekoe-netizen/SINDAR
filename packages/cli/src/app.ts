import {
  createLogger,
  detectPlatform,
  ensureIdentityFiles,
  loadConfig,
  openDatabase,
  ProviderRegistry,
  SessionStore,
  toolsForToolsets,
  collectSecretValues,
  isLang,
  type AgentRuntime,
  type Config,
  type Db,
  type Lang,
  type LoadedConfig,
} from '@sindar/core';
import path from 'node:path';

export interface AppOptions {
  home?: string;
  lang?: string;
}

export interface App extends AgentRuntime {
  loaded: LoadedConfig;
  db: Db;
  close(): Promise<void>;
}

export function pickLang(flag: string | undefined, config?: Config): Lang {
  if (isLang(flag)) return flag;
  if (isLang(process.env.SINDAR_LANG)) return process.env.SINDAR_LANG;
  return config?.ui.language ?? 'ar';
}

/** Load config + DB + providers + tools once per command. */
export async function bootstrap(opts: AppOptions): Promise<App> {
  const loaded = await loadConfig({ home: opts.home, env: process.env });
  const { config, paths, env } = loaded;
  const lang = pickLang(opts.lang, config);
  const platform = detectPlatform(env);
  ensureIdentityFiles(paths);
  const logger = createLogger({
    level: config.logging.level,
    file: config.logging.file ? path.join(paths.logs, 'sindar.log') : undefined,
    secrets: collectSecretValues(env),
    console: false,
  });
  const { db } = await openDatabase(paths.db, { driver: 'auto' });
  const registry = new ProviderRegistry(config, env);
  const tools = toolsForToolsets(config.agent.toolsets);
  const store = new SessionStore(db);
  return {
    loaded,
    config,
    paths,
    platform,
    env,
    lang,
    logger,
    registry,
    tools,
    store,
    db,
    close: async () => {
      await db.close();
    },
  };
}
