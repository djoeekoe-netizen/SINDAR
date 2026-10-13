import type { Config, ProviderConfig, ProviderKind } from '../config/schema.js';
import { getProviderTemplate, PROVIDER_TEMPLATES, type FreeTier } from './templates.js';

export interface ResolvedProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  headers: Record<string, string>;
  requiresKey: boolean;
  free: FreeTier;
  /** True when the provider can be used right now (key present or not needed). */
  configured: boolean;
  enabled: boolean;
  fromTemplate: boolean;
  models?: string[];
  signupUrl?: string;
  notes?: { ar: string; en: string };
}

/** Merge built-in templates with user config + env into usable provider settings. */
export function resolveProviders(
  config: Config,
  env: Record<string, string | undefined>,
): ResolvedProvider[] {
  const ids = new Set<string>([
    ...PROVIDER_TEMPLATES.map((t) => t.id),
    ...Object.keys(config.providers),
  ]);
  const out: ResolvedProvider[] = [];
  for (const id of ids) {
    const r = resolveProvider(id, config.providers[id], env);
    if (r) out.push(r);
  }
  return out;
}

export function resolveProvider(
  id: string,
  userCfg: ProviderConfig | undefined,
  env: Record<string, string | undefined>,
): ResolvedProvider | undefined {
  const tpl = getProviderTemplate(id);
  if (!tpl && !userCfg) return undefined;

  const kind: ProviderKind | undefined = userCfg?.type ?? tpl?.kind;
  if (!kind) return undefined;

  const apiKeyEnv = userCfg?.apiKeyEnv ?? tpl?.apiKeyEnv;
  const baseUrlEnv = `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;
  const baseUrl = userCfg?.baseUrl ?? env[baseUrlEnv] ?? tpl?.baseUrl;
  const apiKey = userCfg?.apiKey ?? (apiKeyEnv ? env[apiKeyEnv] : undefined) ?? undefined;
  const requiresKey = tpl?.requiresKey ?? (kind !== 'mock' && Boolean(apiKeyEnv));
  const hasKey = Boolean(apiKey && apiKey.trim());

  return {
    id,
    name: tpl?.name ?? id,
    kind,
    baseUrl,
    apiKey: hasKey ? apiKey : undefined,
    apiKeyEnv,
    headers: userCfg?.headers ?? {},
    requiresKey,
    free: tpl?.free ?? 'paid',
    configured: kind === 'mock' ? true : requiresKey ? hasKey : true,
    enabled: userCfg?.enabled ?? true,
    fromTemplate: Boolean(tpl),
    models: userCfg?.models,
    signupUrl: tpl?.signupUrl,
    notes: tpl?.notes,
  };
}
