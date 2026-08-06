import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Unit tests for `src/lib` only. Component/route rendering is covered end-to-end by
 * Playwright, so no jsdom environment is needed here — these specs stub `window`,
 * `localStorage`, and `fetch` directly.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
