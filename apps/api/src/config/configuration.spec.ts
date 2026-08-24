import configuration, {
  assertProductionConfig,
  DEV_ACCESS_SECRET,
  DEV_CORS_ORIGIN,
  DEV_ENCRYPTION_KEY,
  DEV_REFRESH_SECRET,
} from './configuration';

/**
 * Boot-time configuration guards.
 *
 * These exist because every production incident this project has had came from an
 * environment variable being wrong, not from application logic being wrong — and each time
 * the API booted happily and reported healthy while being unusable.
 */

const REAL = {
  jwt: { accessSecret: 'a-real-access-secret', refreshSecret: 'a-real-refresh-secret' },
  encryptionKey: 'ab'.repeat(32),
  corsOrigins: ['https://lifecapitalos.com'],
};

describe('assertProductionConfig', () => {
  it('allows a correctly configured production deploy', () => {
    expect(() => assertProductionConfig({ nodeEnv: 'production', ...REAL })).not.toThrow();
  });

  it('never blocks non-production, whatever the config', () => {
    expect(() =>
      assertProductionConfig({
        nodeEnv: 'development',
        jwt: { accessSecret: DEV_ACCESS_SECRET, refreshSecret: DEV_REFRESH_SECRET },
        encryptionKey: DEV_ENCRYPTION_KEY,
        corsOrigins: [DEV_CORS_ORIGIN],
      }),
    ).not.toThrow();
  });

  it.each([
    ['JWT_ACCESS_SECRET', { jwt: { ...REAL.jwt, accessSecret: DEV_ACCESS_SECRET } }],
    ['JWT_REFRESH_SECRET', { jwt: { ...REAL.jwt, refreshSecret: DEV_REFRESH_SECRET } }],
    ['FIELD_ENCRYPTION_KEY', { encryptionKey: DEV_ENCRYPTION_KEY }],
  ])('refuses to start in production with the dev %s', (name, override) => {
    expect(() => assertProductionConfig({ nodeEnv: 'production', ...REAL, ...override })).toThrow(name);
  });

  // CORS_ORIGINS falls back to the localhost default rather than to empty, so an unset
  // variable yields an API that passes its health check and rejects every real browser.
  // That is exactly how this deployment lost logins, twice.
  it('refuses to start in production when CORS_ORIGINS is still the localhost default', () => {
    expect(() =>
      assertProductionConfig({ nodeEnv: 'production', ...REAL, corsOrigins: [DEV_CORS_ORIGIN] }),
    ).toThrow('CORS_ORIGINS');
  });

  it('refuses to start in production with an empty CORS allowlist', () => {
    expect(() => assertProductionConfig({ nodeEnv: 'production', ...REAL, corsOrigins: [] })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it('accepts a real origin listed alongside localhost (mixed dev/prod allowlist)', () => {
    expect(() =>
      assertProductionConfig({
        nodeEnv: 'production',
        ...REAL,
        corsOrigins: [DEV_CORS_ORIGIN, 'https://lifecapitalos.com'],
      }),
    ).not.toThrow();
  });

  it('reports every problem at once rather than one per restart', () => {
    try {
      assertProductionConfig({
        nodeEnv: 'production',
        jwt: { accessSecret: DEV_ACCESS_SECRET, refreshSecret: DEV_REFRESH_SECRET },
        encryptionKey: DEV_ENCRYPTION_KEY,
        corsOrigins: [],
      });
      throw new Error('expected assertProductionConfig to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('JWT_REFRESH_SECRET');
      expect(message).toContain('FIELD_ENCRYPTION_KEY');
      expect(message).toContain('CORS_ORIGINS');
    }
  });
});

describe('configuration()', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('trusts one proxy hop by default — the deployment always runs behind an edge', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(configuration().trustProxyHops).toBe(1);
  });

  it('allows the hop count to be tuned or disabled without a code change', () => {
    process.env.TRUST_PROXY_HOPS = '0';
    expect(configuration().trustProxyHops).toBe(0);
    process.env.TRUST_PROXY_HOPS = '2';
    expect(configuration().trustProxyHops).toBe(2);
  });

  it('keeps Swagger on outside production and off inside it', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SWAGGER_ENABLED;
    expect(configuration().swaggerEnabled).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(configuration().swaggerEnabled).toBe(false);
  });

  it('lets production opt back into Swagger deliberately', () => {
    process.env.NODE_ENV = 'production';
    process.env.SWAGGER_ENABLED = 'true';
    expect(configuration().swaggerEnabled).toBe(true);
  });

  it('derives the email provider from the presence of a key, never from a claim', () => {
    delete process.env.RESEND_API_KEY;
    expect(configuration().email.provider).toBe('console');
    process.env.RESEND_API_KEY = 're_test_key';
    expect(configuration().email.provider).toBe('resend');
  });

  // Build identity. The point of `commit` is to answer "is the merged code live?" directly
  // rather than by inference, so the one thing it must never do is invent an answer: an
  // absent SHA has to stay absent, or a deployment that reports no build would be
  // indistinguishable from one reporting a stale build.
  it('reports no commit when the platform supplies none — never a placeholder', () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.GIT_COMMIT_SHA;
    expect(configuration().build.commit).toBeNull();
  });

  it('shortens the platform SHA to something matchable against git log', () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = '931132441a07cce05c459a85f80e3be87bd1e7a3';
    expect(configuration().build.commit).toBe('9311324');
  });

  it('prefers Railway’s variable but works on any platform that sets GIT_COMMIT_SHA', () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    process.env.GIT_COMMIT_SHA = 'abcdef1234567890';
    expect(configuration().build.commit).toBe('abcdef1');

    process.env.RAILWAY_GIT_COMMIT_SHA = '1234567890abcdef';
    expect(configuration().build.commit).toBe('1234567');
  });

  it('treats a blank or whitespace-only value as absent, not as a build called ""', () => {
    // A value pasted into a platform variable arrives with a trailing newline more often
    // than not, and `''.slice(0, 7)` is a falsy string that would serialise as `commit: ""`.
    process.env.RAILWAY_GIT_COMMIT_SHA = '  \n';
    expect(configuration().build.commit).toBeNull();
    process.env.RAILWAY_GIT_COMMIT_SHA = '';
    delete process.env.GIT_COMMIT_SHA;
    expect(configuration().build.commit).toBeNull();
  });

  it('never returns one-time secrets in production, even when the flag is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.SANDBOX_RETURN_SECRETS = 'true';
    expect(configuration().returnDevSecrets).toBe(false);
  });
});
