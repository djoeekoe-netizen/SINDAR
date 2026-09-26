import { useEffect, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { IconClose } from './icons'

/** نافذة سفلية (Mobile) / مركزية (Desktop) بأسلوب زجاجي */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-root" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-card__head">
          <h3 className="modal-card__title">{title}</h3>
          <button type="button" className="modal-card__close" onClick={onClose} aria-label="close">
            <IconClose size={18} />
          </button>
        </div>
        <div className="modal-card__body">{children}</div>
      </div>
    </div>
  )
}

export function ListRow({
  children,
  onClick,
  active,
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button type="button" className={cn('list-row', active && 'list-row--active')} onClick={onClick}>
      {children}
    </button>
  )
}
