'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import { IconX } from '../icons';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  /** Sticky footer area (usually action buttons). */
  footer?: ReactNode;
  /** Disable closing on backdrop click / Escape (e.g. during a submit). */
  dismissible?: boolean;
  children?: ReactNode;
}

/**
 * Accessible modal dialog rendered in a portal. Locks body scroll, closes on Escape and
 * backdrop click (unless `dismissible={false}`), and is theme-aware. Interactive content
 * is passed as children; actions go in `footer`.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  dismissible = true,
  children,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, dismissible, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-fade-in"
        onClick={() => dismissible && onClose()}
        aria-hidden
      />
      <div
        className={cn(
          'relative w-full rounded-t-card bg-surface text-foreground shadow-elevated animate-scale-in',
          'sm:rounded-card',
          sizeClasses[size],
        )}
      >
        {(title || dismissible) && (
          <div className="flex items-start justify-between gap-4 border-b border-border p-5">
            <div>
              {title && <h2 className="text-lg font-semibold">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-subtle">{description}</p>}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-m-1 rounded-md p-1 text-subtle transition-colors hover:bg-muted hover:text-foreground"
              >
                <IconX className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-border p-5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
