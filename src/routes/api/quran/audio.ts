import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

/**
 * بروكسي صوت — يُستخدم فقط عند فشل الجلب المباشر من متصفح المستخدم (CORS).
 * قائمة بيضاء صارمة + تمرير Range لطلبات التقديم الجزئي.
 */

const ALLOWED_HOSTS = new Set([
  'download.quranicaudio.com',
  'verses.quran.com',
  'audio.qurancdn.com',
  'cdn.islamic.network',
  'everyayah.com',
])

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']

export const Route = createFileRoute('/api/quran/audio')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const target = url.searchParams.get('url')
        if (!target) return new Response('missing url', { status: 400 })

        let parsed: URL
        try {
          parsed = new URL(target)
        } catch {
          return new Response('bad url', { status: 400 })
        }
        if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
          return new Response('host not allowed', { status: 403 })
        }

        const headers: Record<string, string> = { accept: '*/*' }
        const range = request.headers.get('range')
        if (range) headers.range = range

        let upstream: Response
        try {
          upstream = await fetch(parsed.toString(), { headers })
        } catch {
          return new Response('upstream unreachable', { status: 502 })
        }

        const h = new Headers()
        for (const k of PASS_HEADERS) {
          const v = upstream.headers.get(k)
          if (v) h.set(k, v)
        }
        if (!h.has('content-type')) h.set('content-type', 'audio/mpeg')
        h.set('cache-control', 'public, max-age=86400')

        return new Response(upstream.body, { status: upstream.status, headers: h })
      },
    },
  },
})
