export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
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

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001').split(
    ',',
  ),
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '30', 10),
  },
  // 32-byte hex key for AES-256-GCM. Dev default is NOT for production.
  encryptionKey:
    process.env.FIELD_ENCRYPTION_KEY ??
    '0000000000000000000000000000000000000000000000000000000000000000',
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
});
