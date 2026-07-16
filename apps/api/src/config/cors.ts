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
 * Build the NestJS `enableCors` options from the resolved config. Uses the callback form so
 * each request's Origin is validated against the allowlist + preview regex. Never reflects
 * an untrusted origin, and never throws (a disallowed origin resolves to `false`, i.e. the
 * response simply carries no CORS headers).
 */
export function buildCorsOptions(
  allowlist: readonly string[],
  previewRegex: RegExp | null,
): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin ?? undefined, allowlist, previewRegex)),
    credentials: true,
  };
}
