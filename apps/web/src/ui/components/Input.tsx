import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../cn';

const fieldBase =
  'w-full rounded-lg border bg-surface text-foreground placeholder:text-subtle transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

const controlSize = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-10 px-3 text-sm',
  lg: 'h-12 px-4 text-base',
} as const;

type ControlSize = keyof typeof controlSize;

function stateClass(invalid?: boolean) {
  return invalid
    ? 'border-danger focus:ring-danger'
    : 'border-border';
}

// ---------------------------------------------------------------------------
// Field wrapper — label, helper text, and error message around any control.
// ---------------------------------------------------------------------------
export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: ControlSize;
  invalid?: boolean;
  leftIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = 'md', invalid, leftIcon, className, ...rest },
  ref,
) {
  if (leftIcon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
          {leftIcon}
        </span>
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(fieldBase, controlSize[inputSize], stateClass(invalid), 'pl-9', className)}
          {...rest}
        />
      </div>
    );
  }
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, controlSize[inputSize], stateClass(invalid), className)}
      {...rest}
    />
  );
});

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'px-3 py-2 text-sm', stateClass(invalid), className)}
      {...rest}
    />
  );
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  selectSize?: ControlSize;
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { selectSize = 'md', invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        controlSize[selectSize],
        stateClass(invalid),
        'appearance-none bg-[length:1rem] bg-[right_0.6rem_center] bg-no-repeat pr-9',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

/** Convenience: a labelled Input in one call, with auto-generated id wiring. */
export function LabeledInput({
  label,
  hint,
  error,
  required,
  id,
  ...inputProps
}: InputProps & { label?: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field label={label} htmlFor={fieldId} hint={hint} error={error} required={required}>
      <Input id={fieldId} required={required} invalid={Boolean(error)} {...inputProps} />
    </Field>
  );
}
