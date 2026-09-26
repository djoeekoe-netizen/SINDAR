import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '../../../i18n'
import { fetchReciters } from '../../../lib/quran/api'
import { useSetupStore } from '../../../store/useSetupStore'
import { Chip } from '../../ui/Glass'
import { InfoNote, Labeled } from '../../ui/controls'
import { IconChevron, IconSearch } from '../../ui/icons'
import { ListRow, Modal } from '../../ui/Modal'

/** اختيار القارئ — قائمة Quran.com (تزامن دقيق) + مصادر بديلة (تقديري) */
export function ReciterPicker() {
  const t = useT()
  const reciterId = useSetupStore((s) => s.reciterId)
  const setReciter = useSetupStore((s) => s.setReciter)

  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { data, isLoading } = useQuery({
    queryKey: ['reciters'],
    queryFn: fetchReciters,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: mounted,
  })

  const reciters = data?.reciters ?? []
  const degraded = data?.degraded ?? false

  // اختيار افتراضي: أول قارئ من Quran.com
  useEffect(() => {
    if (reciters.length > 0 && !reciterId) setReciter(reciters[0].id)
  }, [reciters, reciterId, setReciter])

  const selected = useMemo(() => reciters.find((r) => r.id === reciterId), [reciters, reciterId])

  const filtered = useMemo(() => {
    const needle = q.trim()
    if (!needle) return reciters
    return reciters.filter((r) => r.nameAr.includes(needle) || (r.nameEn ?? '').toLowerCase().includes(needle.toLowerCase()))
  }, [q, reciters])

  return (
    <Labeled label={t('setup.audioSource')}>
      <button type="button" className="picker-btn" onClick={() => setOpen(true)}>
        {selected ? (
          <>
            <span className="picker-btn__name">{selected.nameAr}</span>
            {selected.sync === 'exact' ? (
              <Chip tone="gold">{t('setup.syncExact')}</Chip>
            ) : (
              <Chip tone="muted">{t('setup.syncEstimated')}</Chip>
            )}
          </>
        ) : (
          <span className="picker-btn__placeholder">{t('setup.reciterPick')}</span>
        )}
        <span className="picker-btn__chev">
          <IconChevron size={16} />
        </span>
      </button>

      {degraded && <InfoNote>{t('setup.degraded')}</InfoNote>}

      <Modal open={open} onClose={() => setOpen(false)} title={t('setup.reciterTab')}>
        <div className="modal-search">
          <IconSearch size={18} />
          <input
            type="search"
            placeholder={t('setup.searchReciter')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        {isLoading ? (
          <div className="modal-loading">
            <span className="ctl-spinner" />
          </div>
        ) : (
          <div className="modal-list">
            {filtered.map((r) => (
              <ListRow
                key={r.id}
                active={r.id === reciterId}
                onClick={() => {
                  setReciter(r.id)
                  setOpen(false)
                }}
              >
                <span className="row-name">{r.nameAr}</span>
                {r.sync === 'exact' ? (
                  <Chip tone="gold">{t('setup.syncExact')}</Chip>
                ) : (
                  <Chip tone="muted">{t('setup.syncEstimated')}</Chip>
                )}
              </ListRow>
            ))}
          </div>
        )}
      </Modal>
    </Labeled>
  )
}
