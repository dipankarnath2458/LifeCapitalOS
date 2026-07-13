import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn';
import { Skeleton } from './Spinner';

/**
 * Primitive table parts (styled `<table>` elements) plus a typed `DataTable` for the
 * common case. Wrap in a `overflow-x-auto` container for small screens.
 */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('border-b border-border', className)} {...rest}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn('divide-y divide-border', className)} {...rest}>
      {children}
    </tbody>
  );
}

export function TR({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors hover:bg-muted/50', className)} {...rest}>
      {children}
    </tr>
  );
}

export function TH({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-subtle',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 text-foreground', className)} {...rest}>
      {children}
    </td>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the row and its index. */
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** Stable row key extractor. */
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  /** Shown when `data` is empty and not loading. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/** Typed, presentational data table with built-in loading + empty handling. */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  empty = 'No data',
  onRowClick,
  className,
}: DataTableProps<T>) {
  return (
    <Table className={className}>
      <THead>
        <tr>
          {columns.map((c) => (
            <TH key={c.key} className={cn(c.align && alignClass[c.align], c.className)}>
              {c.header}
            </TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {loading ? (
          Array.from({ length: 3 }).map((_, r) => (
            <tr key={`sk-${r}`}>
              {columns.map((c) => (
                <TD key={c.key}>
                  <Skeleton />
                </TD>
              ))}
            </tr>
          ))
        ) : data.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-10 text-center text-subtle">
              {empty}
            </td>
          </tr>
        ) : (
          data.map((row, i) => (
            <TR
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {columns.map((c) => (
                <TD key={c.key} className={cn(c.align && alignClass[c.align], c.className)}>
                  {c.cell(row, i)}
                </TD>
              ))}
            </TR>
          ))
        )}
      </TBody>
    </Table>
  );
}
