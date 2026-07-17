import { parsePreviewOriginRegex } from './cors';

export interface AppConfig {
  port: number;
  nodeEnv: string;
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
}

// Dev defaults that must never be used in production. Boot fails fast if they are.
export const DEV_ACCESS_SECRET = 'dev-access-secret-change-me';
export const DEV_REFRESH_SECRET = 'dev-refresh-secret-change-me';
export const DEV_ENCRYPTION_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000';

export default (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  return {
    port: parseInt(process.env.PORT ?? '4000', 10),
    nodeEnv,
    // Opt-in only, and never in production.
    returnDevSecrets: process.env.SANDBOX_RETURN_SECRETS === 'true' && nodeEnv !== 'production',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
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
}): void {
  if (config.nodeEnv !== 'production') return;
  const problems: string[] = [];
  if (config.jwt.accessSecret === DEV_ACCESS_SECRET) problems.push('JWT_ACCESS_SECRET');
  if (config.jwt.refreshSecret === DEV_REFRESH_SECRET) problems.push('JWT_REFRESH_SECRET');
  if (config.encryptionKey === DEV_ENCRYPTION_KEY) problems.push('FIELD_ENCRYPTION_KEY');
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with default dev secrets: ${problems.join(', ')}. ` +
        'Set strong values for these environment variables.',
    );
  }
}
