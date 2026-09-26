import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

/** بروكسي JSON لملف صوت السورة + التوقيتات الرسمية للكلمات (segments) */

const QURAN_API = 'https://api.quran.com/api/v4'

export const Route = createFileRoute('/api/quran/chapter-audio')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url)
        const reciter = Number(u.searchParams.get('reciter'))
        const surah = Number(u.searchParams.get('surah'))
        if (!Number.isInteger(reciter) || !Number.isInteger(surah) || surah < 1 || surah > 114) {
          return Response.json({ error: 'bad params' }, { status: 400 })
        }

        const target = `${QURAN_API}/chapter_recitations/${reciter}/${surah}?segments=true`
        try {
          const r = await fetch(target, { headers: { accept: 'application/json' } })
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
