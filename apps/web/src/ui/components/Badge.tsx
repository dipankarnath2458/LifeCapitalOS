import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeVariant = 'soft' | 'solid' | 'outline';

const soft: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-subtle',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
};

const solid: Record<BadgeTone, string> = {
  neutral: 'bg-foreground text-background',
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
  danger: 'bg-danger text-white',
  info: 'bg-info text-white',
};

const outline: Record<BadgeTone, string> = {
  neutral: 'border border-border text-subtle',
  primary: 'border border-primary/40 text-primary',
  success: 'border border-success/40 text-success',
  warning: 'border border-warning/40 text-warning',
  danger: 'border border-danger/40 text-danger',
  info: 'border border-info/40 text-info',
};

const dotColor: Record<BadgeTone, string> = {
  neutral: 'bg-subtle',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  /** Show a leading status dot. */
  dot?: boolean;
}

/** Compact status/label pill. Tones map to semantic colors; three visual variants. */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  const toneClasses =
    variant === 'solid' ? solid[tone] : variant === 'outline' ? outline[tone] : soft[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClasses,
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColor[tone])} />}
      {children}
    </span>
  );
}
