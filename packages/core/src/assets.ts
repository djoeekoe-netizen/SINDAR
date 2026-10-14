/**
 * Asset directories shipped next to the running program (fonts, …).
 *
 * `@sindar/core` is bundled into the CLI, so it cannot know where its package lives at
 * runtime; the host (CLI, gateway, tests) registers the folder(s) once at startup.
 */
const dirs: string[] = [];

export function registerAssetDir(dir: string): void {
  if (!dirs.includes(dir)) dirs.unshift(dir);
}

export function assetDirs(): readonly string[] {
  return dirs;
}
