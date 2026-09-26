import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { cn } from '../../lib/cn'
import { useExportStore } from '../../store/useExportStore'
import { useUIStore, type Step } from '../../store/useUIStore'
import { IconBook, IconCrescent, IconExport, IconPalette } from '../ui/icons'

export function StepperBar() {
  const t = useT()
  const step = useUIStore((s) => s.step)
  const setStep = useUIStore((s) => s.setStep)
  const toggleLang = useUIStore((s) => s.toggleLang)
  const recording = useExportStore((s) => s.status === 'recording')

  const steps: Array<{ id: Step; label: string; icon: ReactNode }> = [
    { id: 'setup', label: t('steps.setup'), icon: <IconBook size={18} /> },
    { id: 'design', label: t('steps.design'), icon: <IconPalette size={18} /> },
    { id: 'export', label: t('steps.export'), icon: <IconExport size={18} /> },
  ]

  const currentIndex = steps.findIndex((s) => s.id === step)

  return (
    <header className="stepper">
      <div className="stepper__brand">
        <span className="stepper__logo">
          <IconCrescent size={22} />
        </span>
        <span className="stepper__wordmark">SINDAR</span>
        <span className="stepper__tagline">{t('app.subtitle')}</span>
        <button type="button" className="lang-toggle" onClick={toggleLang}>
          {t('app.lang')}
        </button>
      </div>

      <nav className="stepper__nav" aria-label="steps">
        {steps.map((s, i) => {
          const active = s.id === step
          const done = i < currentIndex
          return (
            <button
              key={s.id}
              type="button"
              className={cn('step-btn', active && 'step-btn--active', done && 'step-btn--done')}
              disabled={recording}
              onClick={() => setStep(s.id)}
            >
              <span className="step-btn__dot">{done ? <span className="step-btn__bar" /> : s.icon}</span>
              <span className="step-btn__label">{s.label}</span>
              {i < steps.length - 1 && <span className="step-btn__connector" />}
            </button>
          )
        })}
      </nav>
    </header>
  )
}
