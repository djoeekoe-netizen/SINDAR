import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * الهوية البصرية الفاخرة — Glassmorphism بعمق ثلاثي الأبعاد:
 * حافة ضوء علوية + ظلال متعددة الطبقات + طفو عند hover وضغط عند active.
 */

export function GlassCard({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn('glass-card', className)} {...rest}>
      {children}
    </div>
  )
}

type BtnVariant = 'gold' | 'ghost' | 'danger'
type BtnSize = 'md' | 'lg' | 'icon'

export function GlassButton({
  className,
  variant = 'ghost',
  size = 'md',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return (
    <button
      className={cn(
        'glass-btn',
        `glass-btn--${variant}`,
        size === 'lg' && 'glass-btn--lg',
        size === 'icon' && 'glass-btn--icon',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Chip({
  className,
  tone = 'gold',
  children,
}: {
  className?: string
  tone?: 'gold' | 'emerald' | 'muted'
  children: ReactNode
}) {
  return <span className={cn('chip', `chip--${tone}`, className)}>{children}</span>
}
