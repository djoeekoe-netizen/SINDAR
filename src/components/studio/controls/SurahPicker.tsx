import { useMemo, useState } from 'react'
import { useT } from '../../../i18n'
import { toArabicDigits } from '../../../lib/format'
import { CHAPTERS, getChapter } from '../../../lib/quran/chapters'
import { useUIStore } from '../../../store/useUIStore'
import { useSetupStore } from '../../../store/useSetupStore'
import { Labeled } from '../../ui/controls'
import { IconChevron, IconSearch } from '../../ui/icons'
import { ListRow, Modal } from '../../ui/Modal'

export function SurahPicker() {
  const t = useT()
  const lang = useUIStore((s) => s.lang)
  const surahId = useSetupStore((s) => s.surahId)
  const setSurah = useSetupStore((s) => s.setSurah)

  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const chapter = surahId ? getChapter(surahId) : undefined

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return CHAPTERS
    return CHAPTERS.filter(
      (ch) =>
        ch.nameAr.includes(needle) ||
        ch.nameEn.toLowerCase().includes(needle) ||
        String(ch.id) === needle ||
        toArabicDigits(ch.id) === needle,
    )
  }, [q])

  return (
    <Labeled label={t('setup.surah')}>
      <button type="button" className="picker-btn" onClick={() => setOpen(true)}>
        {chapter ? (
          <>
            <span className="picker-btn__num">{toArabicDigits(chapter.id)}</span>
            <span className="picker-btn__name">{chapter.nameAr}</span>
            <span className="picker-btn__sub">{chapter.nameEn}</span>
          </>
        ) : (
          <span className="picker-btn__placeholder">{t('setup.surahPick')}</span>
        )}
        <span className="picker-btn__chev">
          <IconChevron size={16} />
        </span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('setup.surah')}>
        <div className="modal-search">
          <IconSearch size={18} />
          <input
            type="search"
            placeholder={t('setup.searchSurah')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div className="modal-list">
          {filtered.map((ch) => (
            <ListRow
              key={ch.id}
              active={ch.id === surahId}
              onClick={() => {
                setSurah(ch.id, ch.nameAr)
                setOpen(false)
              }}
            >
              <span className="row-num">{toArabicDigits(ch.id)}</span>
              <span className="row-name">{ch.nameAr}</span>
              <span className="row-sub">{ch.nameEn}</span>
              <span className="row-count">
                {t('setup.versesCount', {
                  n: lang === 'ar' ? toArabicDigits(ch.versesCount) : ch.versesCount,
                })}
              </span>
            </ListRow>
          ))}
          {filtered.length === 0 && <p className="modal-empty">—</p>}
        </div>
      </Modal>
    </Labeled>
  )
}
