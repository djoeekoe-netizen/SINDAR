import { useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { IconChevron } from './icons'

/** عناصر تحكم زجاجية موحّدة — Slider / Toggle / Segmented / Select / Progress … */

export function Section({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('glass-section', open && 'glass-section--open')}>
      <button type="button" className="glass-section__head" onClick={() => setOpen((o) => !o)}>
        <span className="glass-section__icon">{icon}</span>
        <span className="glass-section__title">{title}</span>
        <span className={cn('glass-section__chev', open && 'rotate-180')}>
          <IconChevron size={18} />
        </span>
      </button>
      <div className="glass-section__body">
        <div className="glass-section__content">{children}</div>
      </div>
    </div>
  )
}

export function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="ctl-labeled">
      <span className="ctl-labeled__label">{label}</span>
      {children}
      {hint ? <span className="ctl-labeled__hint">{hint}</span> : null}
    </label>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onInput,
}: {
  value: number
  min: number
  max: number
  step?: number
  onInput: (v: number) => void
}) {
  return (
    <input
      type="range"
      className="ctl-range"
      dir="ltr"
      value={value}
      min={min}
      max={max}
      step={step}
      onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))}
    />
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn('ctl-toggle', checked && 'ctl-toggle--on')}
      onClick={() => onChange(!checked)}
    >
      <span className="ctl-toggle__knob" />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="ctl-segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={cn('ctl-segmented__item', value === o.value && 'ctl-segmented__item--on')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SelectField({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="ctl-select-wrap">
      <select className={cn('ctl-select', className)} {...rest}>
        {children}
      </select>
      <span className="ctl-select__chev">
        <IconChevron size={16} />
      </span>
    </div>
  )
}

export function TextInput({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('ctl-input', className)} {...rest} />
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="ctl-progress" role="progressbar" aria-valuenow={pct}>
      <div className="ctl-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className="ctl-spinner" style={{ width: size, height: size }} aria-hidden />
}

export function ErrorBox({ message }: { message: ReactNode }) {
  return (
    <div className="ctl-error" role="alert">
      {message}
    </div>
  )
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <div className="ctl-note">{children}</div>
}

export function useFieldId(prefix: string) {
  return useId().replace(/:/g, '') + prefix
}
