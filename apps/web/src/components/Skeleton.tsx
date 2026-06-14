/** Pulsing placeholder block for loading states. Decorative, so hidden from a11y tree. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden />;
}
