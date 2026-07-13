import type { ReactNode } from 'react';
import { cn } from '../cn';
import { IconAlert, IconInbox } from '../icons';
import { Button } from './Button';

interface BaseStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary action (label + handler), rendered as a Button. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** Neutral "nothing here yet" state with an optional call to action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: BaseStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-subtle">
        {icon ?? <IconInbox className="h-6 w-6" />}
      </span>
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-subtle">{description}</p>}
      </div>
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** Failure state with an optional retry action. */
export function ErrorState({
  icon,
  title = 'Something went wrong',
  description,
  action,
  className,
}: Partial<BaseStateProps> & { title?: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-danger/30 bg-danger/5 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        {icon ?? <IconAlert className="h-6 w-6" />}
      </span>
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-subtle">{description}</p>}
      </div>
      {action && (
        <Button size="sm" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
