import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type CardVariant = 'default' | 'muted' | 'ghost';

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-surface border border-border shadow-card',
  muted: 'bg-muted',
  // No background utility so callers can supply their own without a class conflict
  // (this project doesn't use tailwind-merge, so stacked `bg-*` classes are ambiguous).
  ghost: '',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Removes inner padding when you need edge-to-edge content (tables, media). */
  flush?: boolean;
}

/** Surface container. Compose with Card.Header/Title/Description/Content/Footer. */
export function Card({ variant = 'default', flush, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn('rounded-card', variantClasses[variant], !flush && 'p-6', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-lg font-semibold text-foreground', className)} {...rest}>
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('mt-0.5 text-sm text-subtle', className)} {...rest}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('text-sm text-foreground', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-4 flex items-center gap-3 border-t border-border pt-4', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A common composite: a KPI / stat tile. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  highlight,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <Card
      // Use the background-less `ghost` variant when highlighted so only `bg-primary`
      // applies (avoids the bg-surface/bg-primary conflict without tailwind-merge).
      variant={highlight ? 'ghost' : 'default'}
      className={cn(
        highlight && 'border border-transparent bg-primary text-primary-foreground shadow-card',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p
            className={cn(
              'text-sm',
              highlight ? 'text-primary-foreground/80' : 'text-subtle',
            )}
          >
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
          {hint && (
            <p
              className={cn(
                'mt-1 text-xs',
                highlight ? 'text-primary-foreground/70' : 'text-subtle',
              )}
            >
              {hint}
            </p>
          )}
        </div>
        {icon && (
          <span className={cn(highlight ? 'text-primary-foreground/80' : 'text-primary')}>
            {icon}
          </span>
        )}
      </div>
    </Card>
  );
}
