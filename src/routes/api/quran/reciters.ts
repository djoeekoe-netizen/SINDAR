import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

/** بروكسي JSON لقائمة قراء السور الكاملة (chapter_reciters) */

const QURAN_API = 'https://api.quran.com/api/v4'

export const Route = createFileRoute('/api/quran/reciters')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const r = await fetch(`${QURAN_API}/resources/chapter_reciters?language=ar`, {
            headers: { accept: 'application/json' },
          })
          if (!r.ok) return Response.json({ error: 'upstream error' }, { status: 502 })
          return new Response(r.body, {
            status: 200,
            headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' },
          })
        } catch {
          return Response.json({ error: 'upstream unreachable' }, { status: 502 })
        }
      },
    },
  },
})
