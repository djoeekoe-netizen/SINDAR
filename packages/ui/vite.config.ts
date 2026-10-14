import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

const GATEWAY = process.env.SINDAR_GATEWAY_URL ?? 'http://127.0.0.1:18789';

/**
 * Build output goes to packages/cli/ui so the CLI tarball ships the web UI and
 * the gateway serves it from there (no separate deploy step on phones).
 */
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: fileURLToPath(new URL('../cli/ui', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': GATEWAY,
      '/health': GATEWAY,
      '/ws': { target: GATEWAY.replace(/^http/, 'ws'), ws: true },
    },
  },
});
