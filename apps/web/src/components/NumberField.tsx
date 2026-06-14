'use client';

export type NumberFieldMode = 'currency' | 'integer' | 'decimal';

/**
 * Numeric input that avoids the controlled-`<input type="number">` desync (which let
 * leading zeros like "075000" stick on screen while the real value differed). It keeps
 * a sanitized digit string in state and, for currency, shows Indian-grouped digits
 * (e.g. 10000000 → "1,00,00,000") so large rupee amounts are readable. Because the
 * displayed value is always derived from sanitized state, the field can never drift.
 */
export function NumberField({
  label,
  value,
  onChange,
  mode = 'currency',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode?: NumberFieldMode;
}) {
  const display = formatForDisplay(value, mode);
  return (
    <label className="text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      <input
        type="text"
        inputMode={mode === 'decimal' ? 'decimal' : 'numeric'}
        value={display}
        onChange={(e) => onChange(sanitize(e.target.value, mode))}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-brand focus:outline-none"
      />
    </label>
  );
}

/** Strip a raw input down to a clean numeric string (no separators, no leading zeros). */
export function sanitize(raw: string, mode: NumberFieldMode): string {
  if (mode === 'decimal') {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    const noExtraDots =
      firstDot === -1
        ? cleaned
        : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    // Trim leading zeros in the integer part but keep a single leading 0 (e.g. "0.5").
    return noExtraDots.replace(/^0+(?=\d)/, '');
  }
  return raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
}

function formatForDisplay(value: string, mode: NumberFieldMode): string {
  if (value === '') return '';
  if (mode === 'currency') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-IN') : value;
  }
  return value;
}

/** Parse a sanitized field string to a number for computation. */
export function parseField(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
