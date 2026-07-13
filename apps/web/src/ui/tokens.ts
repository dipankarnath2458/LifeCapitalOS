/**
 * Design tokens — the single source of truth for the scales the design system uses.
 *
 * Color tokens themselves live as CSS variables in `globals.css` and are surfaced to
 * Tailwind as semantic color utilities (`bg-surface`, `text-foreground`, `bg-primary`,
 * `text-subtle`, `border-border`, `bg-success/10`, …). These TS constants document the
 * non-color scales and are importable where raw pixel values are needed (e.g. matching a
 * JS media query to the CSS breakpoints).
 */

/** Semantic color token names (backed by CSS vars; use as Tailwind color utilities). */
export const colorTokens = [
  'background',
  'surface',
  'muted',
  'border',
  'foreground',
  'subtle',
  'primary',
  'primary-foreground',
  'success',
  'warning',
  'danger',
  'info',
  'ring',
] as const;
export type ColorToken = (typeof colorTokens)[number];

/** Responsive breakpoints (px). Mirrors Tailwind screens incl. the custom `xs`. */
export const breakpoints = {
  xs: 480,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;
export type Breakpoint = keyof typeof breakpoints;

/** `min-width` media query strings for use in JS (e.g. matchMedia). */
export const mediaQuery: Record<Breakpoint, string> = {
  xs: `(min-width: ${breakpoints.xs}px)`,
  sm: `(min-width: ${breakpoints.sm}px)`,
  md: `(min-width: ${breakpoints.md}px)`,
  lg: `(min-width: ${breakpoints.lg}px)`,
  xl: `(min-width: ${breakpoints.xl}px)`,
  '2xl': `(min-width: ${breakpoints['2xl']}px)`,
};

/** Spacing scale (rem). Matches Tailwind's 4px base; use `p-4`, `gap-6`, etc. */
export const spacing = {
  0: '0rem',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const;

/** Border-radius scale (Tailwind names + the design-system `card` radius). */
export const radius = {
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  card: '1rem',
  full: '9999px',
} as const;

/**
 * Typography scale. Consumed by the `Heading`/`Text` components. Each entry is the
 * Tailwind class string that renders that role.
 */
export const typography = {
  display: 'text-4xl font-bold tracking-tight sm:text-5xl',
  h1: 'text-3xl font-bold tracking-tight',
  h2: 'text-2xl font-semibold tracking-tight',
  h3: 'text-xl font-semibold',
  h4: 'text-lg font-semibold',
  lead: 'text-lg text-subtle',
  body: 'text-base',
  small: 'text-sm',
  caption: 'text-xs text-subtle',
  overline: 'text-xs font-semibold uppercase tracking-wider text-subtle',
} as const;
export type TypographyRole = keyof typeof typography;

/** z-index scale for layered UI (dropdowns, sticky nav, modals, toasts). */
export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  drawer: 1200,
  modal: 1300,
  toast: 1400,
} as const;

/** Motion durations (ms). */
export const duration = {
  fast: 120,
  base: 150,
  slow: 250,
} as const;
