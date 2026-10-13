import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * The CLI is distributed as a single bundle that inlines all @sindar/* workspace
 * packages, while third-party runtime deps stay external (declared in package.json),
 * so `npm i -g sindar-x.y.z.tgz` works on any machine — including Termux.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
  noExternal: [/^@sindar\//],
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __SINDAR_VERSION__: JSON.stringify(pkg.version),
    __SINDAR_BUILD__: JSON.stringify(process.env.SINDAR_BUILD_SHA ?? 'local'),
  },
});
