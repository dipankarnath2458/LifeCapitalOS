import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { Spinner } from './Spinner';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  secondary: 'bg-muted text-foreground hover:bg-muted/70',
  outline: 'border border-border bg-surface text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-sm',
  success: 'bg-success text-white hover:bg-success/90 shadow-sm',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-10 w-10 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/**
 * Primary interactive control. Variants + sizes + a built-in `loading` state that shows
 * a spinner and disables interaction. Theme-aware via semantic tokens.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    leftIcon,
    rightIcon,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full justify-center',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {size !== 'icon' && children}
      {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
});
