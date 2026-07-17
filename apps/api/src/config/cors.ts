import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS origin policy for the API.
 *
 * The API is called cross-origin by the web app (a separate Vercel deployment) and must
 * allow exactly the origins we trust — never `*` (we send `credentials: true`). Production
 * origins are an explicit allowlist (`CORS_ORIGINS`). Vercel **preview** deployments,
 * however, get a *new, per-commit* hostname on every deploy
 * (e.g. `life-capital-os-web-git-<branch>-<team>.vercel.app`), which a static allowlist can
 * never contain. To support previews **without weakening security**, an optional,
 * tightly-scoped regex (`CORS_PREVIEW_ORIGIN_REGEX`) additionally allows this project's own
 * preview origins — anchored to our exact project prefix **and** Vercel team slug, so no
 * third-party `*.vercel.app` site can match.
 */

/** Compile the optional preview-origin regex from an env string; null when unset/invalid. */
export function parsePreviewOriginRegex(raw: string | undefined): RegExp | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    // Force full-string anchoring if the operator didn't, so a substring can't sneak past.
    const anchored = value.startsWith('^') || value.endsWith('$') ? value : `^(?:${value})$`;
    return new RegExp(anchored);
  } catch {
    return null;
  }
}

/**
 * Decide whether a request Origin is allowed. Pure and deterministic.
 * - No Origin (server-to-server, health checks, same-origin) → allowed.
 * - Origin in the explicit allowlist → allowed (production behaviour, unchanged).
 * - Origin matches the scoped preview regex → allowed (Vercel previews).
 * - Otherwise → not allowed (no `Access-Control-Allow-Origin` emitted → browser blocks).
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowlist: readonly string[],
  previewRegex: RegExp | null,
): boolean {
  if (!origin) return true;
  if (allowlist.includes(origin)) return true;
  if (previewRegex !== null && previewRegex.test(origin)) return true;
  return false;
}

/**
 * Build the NestJS `enableCors` options from the resolved config.
 *
 * IMPORTANT — the origin is an **array** of allowed strings plus (optionally) the preview
 * RegExp, NOT a callback function. The `cors` package treats a callback that resolves to
 * `false` (a disallowed origin) by calling `next()` **without terminating the OPTIONS
 * preflight** — so the preflight falls through to routing and returns **404** (there is no
 * `OPTIONS` route handler). An array origin is always truthy, so `cors` always short-circuits
 * the preflight with a 204, attaching `Access-Control-Allow-Origin` only when the request
 * origin matches one of the strings or the RegExp. This is what makes `OPTIONS /api/auth/login`
 * return a proper preflight for allowed origins and a clean 204-without-headers (never 404)
 * for others. `cors` natively supports mixed string/RegExp arrays.
 */
export function buildCorsOptions(
  allowlist: readonly string[],
  previewRegex: RegExp | null,
): CorsOptions {
  const origin: (string | RegExp)[] = [...allowlist];
  if (previewRegex !== null) origin.push(previewRegex);
  return { origin, credentials: true };
}
