import { useMemo } from 'react'
import { useT } from '../../../i18n'
import { getChapter } from '../../../lib/quran/chapters'
import { toArabicDigits } from '../../../lib/format'
import { useSetupStore, type TranslationId } from '../../../store/useSetupStore'
import { useUIStore } from '../../../store/useUIStore'
import {
  ErrorBox,
  Labeled,
  Segmented,
  SelectField,
  Spinner,
  TextInput,
} from '../../ui/controls'
import { GlassButton, GlassCard } from '../../ui/Glass'
import { IconSparkle } from '../../ui/icons'
import { AudioUpload } from '../controls/AudioUpload'
import { ReciterPicker } from '../controls/ReciterPicker'
import { SurahPicker } from '../controls/SurahPicker'
import { useProjectLoader } from '../hooks/useProjectLoader'

export function SetupStep() {
  const t = useT()
  const lang = useUIStore((s) => s.lang)
  const { build, loadSample, loading, stage, error } = useProjectLoader()

  const surahId = useSetupStore((s) => s.surahId)
  const customName = useSetupStore((s) => s.customName)
  const setCustomName = useSetupStore((s) => s.setCustomName)
  const fromAyah = useSetupStore((s) => s.fromAyah)
  const toAyah = useSetupStore((s) => s.toAyah)
  const setFrom = useSetupStore((s) => s.setFrom)
  const setTo = useSetupStore((s) => s.setTo)
  const audioMode = useSetupStore((s) => s.audioMode)
  const setAudioMode = useSetupStore((s) => s.setAudioMode)
  const translationId = useSetupStore((s) => s.translationId)
  const setTranslationId = useSetupStore((s) => s.setTranslationId)

  const chapter = surahId ? getChapter(surahId) : undefined

  const rangeHint = useMemo(() => {
    if (!chapter) return null
    if (!fromAyah || !toAyah) return t('setup.rangeEmpty')
    const f = Number(fromAyah)
    const tt = Number(toAyah)
    if (!Number.isFinite(f) || !Number.isFinite(tt) || f < 1 || tt < 1) return t('setup.rangeInvalid')
    if (f > tt) return t('setup.rangeOrder')
    if (tt > chapter.versesCount)
      return t('setup.rangeLimit', { n: lang === 'ar' ? toArabicDigits(chapter.versesCount) : chapter.versesCount })
    return null
  }, [chapter, fromAyah, toAyah, t, lang])

  return (
    <div className="step-page">
      <GlassCard className="step-card rise-in">
        <h2 className="step-card__title">{t('steps.setup')}</h2>

        <div className="step-card__grid">
          <SurahPicker />

          <Labeled label={t('setup.customName')} hint={t('setup.customNameHint')}>
            <TextInput
              value={customName}
              placeholder={chapter?.nameAr ?? ''}
              onChange={(e) => setCustomName(e.target.value)}
              maxLength={40}
            />
          </Labeled>

          <div className="range-row">
            <Labeled label={t('setup.range')}>
              <div className="range-inputs">
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={chapter?.versesCount}
                  placeholder={t('setup.from')}
                  value={fromAyah}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <span className="range-sep">—</span>
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={chapter?.versesCount}
                  placeholder={t('setup.to')}
                  value={toAyah}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </Labeled>
            <p className={rangeHint ? 'range-hint range-hint--warn' : 'range-hint'}>
              {chapter
                ? (rangeHint ?? t('setup.rangeMax', { n: lang === 'ar' ? toArabicDigits(chapter.versesCount) : chapter.versesCount }))
                : ' '}
            </p>
          </div>

          <div className="audio-source">
            <Segmented
              value={audioMode}
              onChange={setAudioMode}
              options={[
                { value: 'reciter', label: t('setup.reciterTab') },
                { value: 'upload', label: t('setup.uploadTab') },
              ]}
            />
            <div className="audio-source__body">
              {audioMode === 'reciter' ? <ReciterPicker /> : <AudioUpload />}
            </div>
          </div>

          <Labeled label={t('setup.translation')}>
            <SelectField
              value={String(translationId)}
              onChange={(e) => setTranslationId(Number(e.target.value) as TranslationId)}
            >
              <option value="131">{t('setup.transKhattab')}</option>
              <option value="20">{t('setup.transSaheeh')}</option>
            </SelectField>
          </Labeled>
        </div>

        {error && <ErrorBox message={error} />}

        <div className="step-card__cta">
          <GlassButton variant="gold" size="lg" disabled={loading} onClick={() => void build()}>
            {loading ? (
              <>
                <Spinner size={18} />
                {t(stage ?? 'stage.verses')}
              </>
            ) : (
              t('setup.build')
            )}
          </GlassButton>
          <button type="button" className="ghost-link" onClick={loadSample} disabled={loading}>
            <IconSparkle size={16} />
            {t('setup.sample')}
          </button>
        </div>
      </GlassCard>
    </div>
  )
}
