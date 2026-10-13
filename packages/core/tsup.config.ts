import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  define: {
    __SINDAR_VERSION__: JSON.stringify(pkg.version),
    __SINDAR_BUILD__: JSON.stringify(process.env.SINDAR_BUILD_SHA ?? 'local'),
  },
});
