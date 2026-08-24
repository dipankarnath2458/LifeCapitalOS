import { parsePreviewOriginRegex } from './cors';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  /**
   * Which build is running, surfaced on `/api/health`.
   *
   * Confirming that a merged milestone is actually live used to require inferring it from
   * whether an authenticated route answered 401 or 404, because nothing the deployment
   * exposes names its own build. Railway injects `RAILWAY_GIT_COMMIT_SHA` into the service
   * environment; other platforms set `GIT_COMMIT_SHA`. `null` when neither is present —
   * "unknown" is reported as unknown, never as a plausible-looking placeholder.
   */
  build: { commit: string | null };
  /**
   * When true, one-time secrets (OTP codes, password-reset tokens) are returned in
   * API responses for local testing. Opt-in ONLY (SANDBOX_RETURN_SECRETS=true) — never
   * derived from NODE_ENV, so a misconfigured deploy cannot leak them. Forced off in
   * production regardless of the flag.
   */
  returnDevSecrets: boolean;
  corsOrigins: string[];
  /**
   * Optional, tightly-scoped regex allowing this project's Vercel **preview** origins
   * (which change per deploy and can't be in `corsOrigins`). Null when unset. See cors.ts.
   */
  corsPreviewOriginRegex: RegExp | null;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtlDays: number;
  };
  encryptionKey: string;
  razorpay: {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
    sandbox: boolean;
  };
  aa: {
    provider: string;
    apiKey: string;
    sandbox: boolean;
  };
  ai: {
    apiKey: string;
    model: string;
    enabled: boolean;
  };
  /**
   * How many reverse-proxy hops to trust for client-IP resolution. The API runs behind
   * Railway's edge, so without this Express reports the PROXY's address as `req.ip` —
   * which silently breaks two things: the rate limiter buckets every client in the world
   * together, and the audit trail records the proxy instead of the actor.
   */
  trustProxyHops: number;
  /** Whether to mount Swagger at /api/docs. Off by default in production. */
  swaggerEnabled: boolean;
  email: {
    /**
     * `resend` when an API key is present, otherwise `console` (logs instead of sending).
     * Derived, not read directly, so a deploy cannot claim a provider it has no key for.
     */
    provider: 'resend' | 'console';
    apiKey: string;
    /** RFC-5322 From header, e.g. `Life Capital OS <no-reply@lifecapitalos.com>`. */
    from: string;
    /** Public web origin used to build links in emails (no trailing slash needed). */
    appUrl: string;
  };
}

// Dev defaults that must never be used in production. Boot fails fast if they are.
export const DEV_ACCESS_SECRET = 'dev-access-secret-change-me';
export const DEV_REFRESH_SECRET = 'dev-refresh-secret-change-me';
export const DEV_ENCRYPTION_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000';
export const DEV_CORS_ORIGIN = 'http://localhost:3000';

export default (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const corsOrigins = (process.env.CORS_ORIGINS ?? DEV_CORS_ORIGIN)
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return {
    port: parseInt(process.env.PORT ?? '4000', 10),
    nodeEnv,
    // Short SHA only: enough to identify a build against `git log`, and the smallest thing
    // that answers "is the merged code live?". Whitespace-trimmed because a value pasted
    // into a platform variable often carries a trailing newline.
    build: {
      commit:
        (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? '')
          .trim()
          .slice(0, 7) || null,
    },
    // Opt-in only, and never in production.
    returnDevSecrets: process.env.SANDBOX_RETURN_SECRETS === 'true' && nodeEnv !== 'production',
    corsOrigins,
    corsPreviewOriginRegex: parsePreviewOriginRegex(process.env.CORS_PREVIEW_ORIGIN_REGEX),
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? DEV_ACCESS_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? DEV_REFRESH_SECRET,
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '30', 10),
    },
    // 32-byte hex key for AES-256-GCM. Dev default is NOT for production.
    encryptionKey: process.env.FIELD_ENCRYPTION_KEY ?? DEV_ENCRYPTION_KEY,
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID ?? 'rzp_test_dummy',
      keySecret: process.env.RAZORPAY_KEY_SECRET ?? 'dummy_secret',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? 'dummy_webhook',
      sandbox: (process.env.RAZORPAY_SANDBOX ?? 'true') === 'true',
    },
    aa: {
      provider: process.env.AA_PROVIDER ?? 'setu',
      apiKey: process.env.AA_API_KEY ?? 'dummy_aa_key',
      sandbox: (process.env.AA_SANDBOX ?? 'true') === 'true',
    },
    ai: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      // The coach is enabled only when an API key is present.
      enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    // 1 hop = Railway's (or Vercel's) edge. Set to 0 only when the process is exposed
    // directly to clients, since a trusted hop lets that hop set X-Forwarded-For.
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
    // Opt-in in production; on by default anywhere else so local dev keeps the docs.
    swaggerEnabled:
      process.env.SWAGGER_ENABLED === 'true' ||
      (nodeEnv !== 'production' && process.env.SWAGGER_ENABLED !== 'false'),
    email: {
      provider: process.env.RESEND_API_KEY ? 'resend' : 'console',
      apiKey: process.env.RESEND_API_KEY ?? '',
      from: process.env.EMAIL_FROM ?? 'Life Capital OS <onboarding@resend.dev>',
      // Falls back to the first allowed browser origin, which is the web app by definition,
      // so links are right in every environment that has CORS configured correctly.
      appUrl: process.env.APP_URL ?? corsOrigins[0] ?? 'http://localhost:3000',
    },
  };
};

/**
 * Guard against shipping dev secrets to production. Called during app bootstrap; throws
 * (crashing the boot) if a production deploy is still using any built-in dev default.
 */
export function assertProductionConfig(config: {
  nodeEnv: string;
  jwt: { accessSecret: string; refreshSecret: string };
  encryptionKey: string;
  corsOrigins?: string[];
}): void {
  if (config.nodeEnv !== 'production') return;
  const problems: string[] = [];
  if (config.jwt.accessSecret === DEV_ACCESS_SECRET) problems.push('JWT_ACCESS_SECRET');
  if (config.jwt.refreshSecret === DEV_REFRESH_SECRET) problems.push('JWT_REFRESH_SECRET');
  if (config.encryptionKey === DEV_ENCRYPTION_KEY) problems.push('FIELD_ENCRYPTION_KEY');
  // CORS_ORIGINS falls back to the localhost dev default rather than to empty, so an unset
  // variable produces an API that boots healthily and then rejects every real browser —
  // which is exactly how this deployment lost logins twice. Fail loudly at boot instead.
  const origins = config.corsOrigins ?? [];
  if (origins.length === 0 || origins.every((o) => o === DEV_CORS_ORIGIN)) {
    problems.push('CORS_ORIGINS');
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with default dev configuration: ${problems.join(', ')}. ` +
        'Set real values for these environment variables.',
    );
  }
}
