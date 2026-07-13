import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

const spinnerSize = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
} as const;

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof spinnerSize;
  label?: string;
}

/** Indeterminate spinner. Inherits `currentColor` for the visible arc. */
export function Spinner({ size = 'md', label = 'Loading', className, ...rest }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex', className)} {...rest}>
      <span
        className={cn(
          'animate-spin rounded-full border-current border-t-transparent',
          spinnerSize[size],
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

const skeletonVariant = {
  text: 'h-4 w-full rounded',
  title: 'h-6 w-2/3 rounded',
  circle: 'rounded-full',
  rect: 'rounded-lg',
} as const;

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof skeletonVariant;
}

/** Content placeholder shown while data loads. */
export function Skeleton({ variant = 'text', className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse bg-muted', skeletonVariant[variant], className)}
      {...rest}
    />
  );
}

/** Centered spinner + optional label — a full loading state for a panel or page. */
export function LoadingState({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 py-12 text-subtle', className)}
    >
      <Spinner size="lg" className="text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Absolute overlay that dims and blocks a container while it loads (container needs `relative`). */
export function LoadingOverlay({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-surface/70 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-subtle">
        <Spinner className="text-primary" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
