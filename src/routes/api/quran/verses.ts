import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

/** بروكسي JSON لآيات Quran.com — احتياط عند فشل الجلب المباشر من المتصفح */

const QURAN_API = 'https://api.quran.com/api/v4'

export const Route = createFileRoute('/api/quran/verses')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url)
        const surah = Number(u.searchParams.get('surah'))
        const page = Number(u.searchParams.get('page') ?? '1')
        const translation = Number(u.searchParams.get('translation') ?? '131')
        if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
          return Response.json({ error: 'bad surah' }, { status: 400 })
        }

        const target = `${QURAN_API}/verses/by_chapter/${surah}?language=en&words=true&word_fields=text_uthmani&translations=${translation}&fields=text_uthmani&per_page=50&page=${page}`

        try {
          const r = await fetch(target, { headers: { accept: 'application/json' } })
          if (!r.ok) return Response.json({ error: 'upstream error' }, { status: 502 })
          return new Response(r.body, {
            status: 200,
            headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
          })
        } catch {
          return Response.json({ error: 'upstream unreachable' }, { status: 502 })
        }
      },
    },
  },
})
