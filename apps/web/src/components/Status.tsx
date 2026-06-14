'use client';

export type Band = 'green' | 'yellow' | 'red';

/**
 * Status metadata so health signals never rely on colour alone (WCAG 1.4.1): each
 * band carries a text label and a distinct shape glyph alongside its colour.
 */
export const BAND_META: Record<Band, { label: string; glyph: string; dot: string; ring: string; text: string }> = {
  green: { label: 'Healthy', glyph: '●', dot: 'bg-emerald-500', ring: 'ring-emerald-200 bg-emerald-50', text: 'text-emerald-700' },
  yellow: { label: 'Caution', glyph: '▲', dot: 'bg-amber-500', ring: 'ring-amber-200 bg-amber-50', text: 'text-amber-700' },
  red: { label: 'At risk', glyph: '■', dot: 'bg-rose-500', ring: 'ring-rose-200 bg-rose-50', text: 'text-rose-700' },
};

/** A pill showing a status with colour, shape and an explicit text label. */
export function StatusBadge({ band, headline }: { band: Band; headline?: string }) {
  const m = BAND_META[band];
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ring-1 ${m.ring} ${m.text}`}
    >
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
      <span>{headline ?? m.label}</span>
    </span>
  );
}

/** A small status marker (shape + colour) with an accessible label for screen readers. */
export function StatusDot({ band }: { band: Band }) {
  const m = BAND_META[band];
  return (
    <>
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${m.dot}`} />
      <span className="sr-only">{m.label}: </span>
    </>
  );
}
