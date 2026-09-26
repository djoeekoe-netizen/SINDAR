import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // قبول مضيف المعاينة (البروكسي الخارجي) في بيئة التطوير
    allowedHosts: true,
    host: true,
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})

export default config
