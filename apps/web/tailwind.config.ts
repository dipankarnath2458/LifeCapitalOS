import type { Config } from 'tailwindcss';

/**
 * Life Capital OS design-system Tailwind config.
 *
 * Colors are exposed as semantic tokens backed by CSS variables (see globals.css),
 * so every component works in both light and dark themes with no per-component
 * conditionals. Raw `<alpha-value>` support means `bg-success/10` etc. produce soft
 * tints automatically. The original `brand` palette is preserved for existing V1 pages.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // adds an extra-small breakpoint; sm/md/lg/xl/2xl remain the Tailwind defaults
        xs: '480px',
      },
      colors: {
        // --- Legacy brand palette (kept so existing pages render unchanged) ---
        brand: {
          DEFAULT: '#0f766e',
          dark: '#115e59',
          light: '#5eead4',
        },
        // --- V2 semantic tokens (CSS-variable backed, theme-aware) ---
        background: 'rgb(var(--ds-background) / <alpha-value>)',
        surface: 'rgb(var(--ds-surface) / <alpha-value>)',
        muted: 'rgb(var(--ds-muted) / <alpha-value>)',
        border: 'rgb(var(--ds-border) / <alpha-value>)',
        foreground: 'rgb(var(--ds-foreground) / <alpha-value>)',
        subtle: 'rgb(var(--ds-subtle) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--ds-primary) / <alpha-value>)',
          foreground: 'rgb(var(--ds-primary-foreground) / <alpha-value>)',
        },
        success: 'rgb(var(--ds-success) / <alpha-value>)',
        warning: 'rgb(var(--ds-warning) / <alpha-value>)',
        danger: 'rgb(var(--ds-danger) / <alpha-value>)',
        info: 'rgb(var(--ds-info) / <alpha-value>)',
        ring: 'rgb(var(--ds-ring) / <alpha-value>)',
      },
      borderRadius: {
        card: '1rem',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        elevated: '0 10px 30px -12px rgb(0 0 0 / 0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'scale-in': 'scale-in 0.15s ease-out',
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
