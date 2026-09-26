import { useEffect } from 'react'
import { useT } from '../../../i18n'
import {
  HIGHLIGHT_COLORS,
  QURAN_FONTS,
  type DisplayMode,
  type FontId,
  type HighlightColor,
  type RevealMode,
  type VisPosition,
  type VisStyle,
} from '../../../lib/canvas/design'
import { useDesignStore } from '../../../store/useDesignStore'
import { useEngineStore } from '../../../store/useEngineStore'
import { Chip } from '../../ui/Glass'
import {
  InfoNote,
  Labeled,
  Section,
  Segmented,
  SelectField,
  Slider,
  TextInput,
  Toggle,
} from '../../ui/controls'
import { IconBell, IconPalette, IconSparkle, IconType, IconWave } from '../../ui/icons'
import { BackgroundPicker } from '../controls/BackgroundPicker'

const FONT_OPTIONS = (Object.keys(QURAN_FONTS) as FontId[]).map((id) => ({
  value: id,
  label: QURAN_FONTS[id].labelAr,
}))

export function DesignStep() {
  const t = useT()
  // إعادة تفعيل التفضيلات المحفوظة (persist بوضع skipHydration)
  useEffect(() => {
    void useDesignStore.persist.rehydrate()
  }, [])

  const d = useDesignStore()
  const exact = useEngineStore((s) => s.timeline?.exact ?? false)

  return (
    <div className="step-page">
      <div className="design-panels">
        <Section title={t('design.bg')} icon={<IconPalette size={18} />} defaultOpen>
          <BackgroundPicker />
        </Section>

        <Section title={t('design.displayMode')} icon={<IconBell size={18} />}>
          <Segmented<DisplayMode>
            value={d.displayMode}
            onChange={(v) => d.set('displayMode', v)}
            options={[
              { value: 'normal', label: t('design.modeNormal') },
              { value: 'notification', label: t('design.modeNotification') },
            ]}
          />
          {d.displayMode === 'notification' && (
            <div className="ctl-stack">
              <Labeled label={t('design.notifApp')}>
                <TextInput
                  value={d.notifAppName}
                  maxLength={20}
                  onChange={(e) => d.set('notifAppName', e.target.value)}
                />
              </Labeled>
            </div>
          )}
        </Section>

        <Section title={t('design.text')} icon={<IconType size={18} />} defaultOpen>
          <div className="ctl-stack">
            <Labeled label={t('design.font')}>
              <SelectField value={d.font} onChange={(e) => d.set('font', e.target.value as FontId)}>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </SelectField>
            </Labeled>

            <Labeled label={`${t('design.fontSize')} — ${d.fontSize}`}>
              <Slider value={d.fontSize} min={48} max={110} step={2} onInput={(v) => d.set('fontSize', v)} />
            </Labeled>

            <div className="ctl-row">
              <span className="ctl-row__label">{t('design.shadow')}</span>
              <Toggle checked={d.textShadow} onChange={(v) => d.set('textShadow', v)} />
            </div>

            <div className="ctl-row">
              <span className="ctl-row__label">{t('design.badge')}</span>
              <Toggle checked={d.showBadge} onChange={(v) => d.set('showBadge', v)} />
            </div>

            <div className="ctl-row">
              <span className="ctl-row__label">{t('design.translation')}</span>
              <Toggle checked={d.showTranslation} onChange={(v) => d.set('showTranslation', v)} />
            </div>

            <Labeled label={t('design.highlight')}>
              <Segmented<HighlightColor>
                value={d.highlight}
                onChange={(v) => d.set('highlight', v)}
                options={(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((k) => ({
                  value: k,
                  label: HIGHLIGHT_COLORS[k].nameAr,
                }))}
              />
            </Labeled>
          </div>
        </Section>

        <Section title={t('design.animation')} icon={<IconSparkle size={18} />}>
          <Segmented<RevealMode>
            value={d.reveal}
            onChange={(v) => d.set('reveal', v)}
            options={[
              { value: 'karaoke', label: t('design.karaoke') },
              { value: 'fade', label: t('design.fade') },
              { value: 'scale', label: t('design.scale') },
              { value: 'pop3d', label: t('design.pop3d') },
            ]}
          />
          <InfoNote>
            {exact ? <Chip tone="gold">{t('setup.syncExact')}</Chip> : <Chip tone="muted">{t('setup.syncEstimated')}</Chip>}
          </InfoNote>
        </Section>

        <Section title={t('design.visualizer')} icon={<IconWave size={18} />}>
          <div className="ctl-stack">
            <div className="ctl-row">
              <span className="ctl-row__label">{t('design.on')}</span>
              <Toggle checked={d.visualizer.on} onChange={(v) => d.setVisualizer({ on: v })} />
            </div>
            {d.visualizer.on && (
              <>
                <Segmented<VisStyle>
                  value={d.visualizer.style}
                  onChange={(v) => d.setVisualizer({ style: v })}
                  options={[
                    { value: 'bars', label: t('design.bars') },
                    { value: 'wave', label: t('design.wave') },
                  ]}
                />
                <Segmented<VisPosition>
                  value={d.visualizer.position}
                  onChange={(v) => d.setVisualizer({ position: v })}
                  options={[
                    { value: 'bottom', label: t('design.posBottom') },
                    { value: 'behind', label: t('design.posBehind') },
                  ]}
                />
                <Labeled label={t('design.color')}>
                  <Segmented<HighlightColor>
                    value={d.visualizer.color}
                    onChange={(v) => d.setVisualizer({ color: v })}
                    options={(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((k) => ({
                      value: k,
                      label: HIGHLIGHT_COLORS[k].nameAr,
                    }))}
                  />
                </Labeled>
              </>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}
