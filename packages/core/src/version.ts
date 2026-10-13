declare const __SINDAR_VERSION__: string | undefined;
declare const __SINDAR_BUILD__: string | undefined;

/** Semantic version of SINDAR (injected at build time). */
export const VERSION: string =
  typeof __SINDAR_VERSION__ !== 'undefined' ? __SINDAR_VERSION__ : '0.1.0';

/** Build identifier: git SHA (CI) or "local". */
export const BUILD: string = typeof __SINDAR_BUILD__ !== 'undefined' ? __SINDAR_BUILD__ : 'local';

export const MIN_NODE = { major: 22, minor: 13 } as const;

export function nodeVersionOk(version: string = process.versions.node): boolean {
  const [maj = 0, min = 0] = version.split('.').map((n) => Number.parseInt(n, 10));
  if (maj > MIN_NODE.major) return true;
  return maj === MIN_NODE.major && min >= MIN_NODE.minor;
}
