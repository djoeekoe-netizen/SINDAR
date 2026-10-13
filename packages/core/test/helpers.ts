import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema, type ConfigInput } from '../src/config/schema.js';
import { openDatabase } from '../src/db/open.js';
import { silentLogger } from '../src/logger.js';
import { ensureHome, getPaths } from '../src/paths.js';
import { detectPlatform } from '../src/platform.js';
import { createPolicyState } from '../src/policy/index.js';
import { ProviderRegistry, type ProviderRegistryOptions } from '../src/providers/registry.js';
import { toolsForToolsets } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/types.js';
import { SessionStore } from '../src/agent/sessions.js';
import type { AgentRuntime } from '../src/agent/loop.js';

export interface TestRuntime extends AgentRuntime {
  home: string;
  cleanup(): Promise<void>;
}

export async function makeRuntime(
  overrides: ConfigInput = {},
  regOpts: ProviderRegistryOptions = {},
  env: Record<string, string | undefined> = {},
): Promise<TestRuntime> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-rt-'));
  const paths = getPaths(home);
  ensureHome(paths);
  const config = ConfigSchema.parse({
    ...overrides,
    agent: { ...overrides.agent, workspace: paths.workspace },
  });
  const { db } = await openDatabase(paths.db, { driver: 'auto' });
  const fullEnv = { PATH: process.env.PATH, HOME: home, ...env };
  const rt: TestRuntime = {
    home,
    config,
    paths,
    platform: detectPlatform(fullEnv as Record<string, string | undefined>),
    env: fullEnv,
    lang: 'en',
    logger: silentLogger,
    registry: new ProviderRegistry(config, fullEnv, regOpts),
    tools: toolsForToolsets(config.agent.toolsets),
    store: new SessionStore(db),
    cleanup: async () => {
      await db.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
  return rt;
}

export function toolContext(rt: AgentRuntime, cwd = rt.paths.workspace): ToolContext {
  return {
    cwd,
    workspace: rt.paths.workspace,
    home: rt.paths.home,
    paths: rt.paths,
    env: rt.env,
    platform: rt.platform,
    lang: 'en',
    logger: rt.logger,
    limits: { maxOutputChars: 2000, timeoutMs: 10_000 },
    saveOverflow: (name, text) => {
      const f = path.join(rt.paths.logs, `${name}.txt`);
      fs.writeFileSync(f, text);
      return f;
    },
  };
}

export const policy = (
  mode: 'ask' | 'allowlist' | 'yolo' = 'ask',
  allowlist: string[] = ['echo', 'ls'],
) => createPolicyState(mode, allowlist);
