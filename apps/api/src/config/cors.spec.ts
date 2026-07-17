import { Controller, INestApplication, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { isOriginAllowed, parsePreviewOriginRegex, buildCorsOptions } from './cors';

/**
 * CORS policy tests. Locks in: production allowlist behaviour is unchanged; this project's
 * Vercel preview origins are allowed via the scoped regex; and — the security-critical part —
 * arbitrary/other-team `*.vercel.app` origins are rejected.
 */

// The exact production + preview shapes observed for this deployment.
const ALLOWLIST = ['https://lifecapitalos.com', 'https://www.lifecapitalos.com'];
// Scoped to project prefix `life-capital-os` AND team slug `dipankarfin58-8320s-projects`.
const PREVIEW_REGEX = parsePreviewOriginRegex(
  '^https://life-capital-os[a-z0-9-]*-dipankarfin58-8320s-projects\\.vercel\\.app$',
);

describe('isOriginAllowed', () => {
  it('allows the production origins (unchanged behaviour)', () => {
    expect(isOriginAllowed('https://lifecapitalos.com', ALLOWLIST, PREVIEW_REGEX)).toBe(true);
    expect(isOriginAllowed('https://www.lifecapitalos.com', ALLOWLIST, PREVIEW_REGEX)).toBe(true);
  });

  it('allows this project’s Vercel preview origins (both alias forms)', () => {
    // Branch alias (posted in PR comments)
    expect(
      isOriginAllowed(
        'https://life-capital-os-web-git-cla-8a237b-dipankarfin58-8320s-projects.vercel.app',
        ALLOWLIST,
        PREVIEW_REGEX,
      ),
    ).toBe(true);
    // Deployment alias (project name truncated, no `web`)
    expect(
      isOriginAllowed(
        'https://life-capital-os-gjam6438t-dipankarfin58-8320s-projects.vercel.app',
        ALLOWLIST,
        PREVIEW_REGEX,
      ),
    ).toBe(true);
  });

  it('allows requests with no Origin (server-to-server / health checks)', () => {
    expect(isOriginAllowed(undefined, ALLOWLIST, PREVIEW_REGEX)).toBe(true);
  });

  it('rejects arbitrary and other-team vercel.app origins (no security widening)', () => {
    // Different team slug — an attacker’s own Vercel project cannot use our team slug.
    expect(
      isOriginAllowed('https://life-capital-os-web-git-x-someone-elses-projects.vercel.app', ALLOWLIST, PREVIEW_REGEX),
    ).toBe(false);
    // Right team slug but different project family.
    expect(
      isOriginAllowed('https://evil-app-dipankarfin58-8320s-projects.vercel.app', ALLOWLIST, PREVIEW_REGEX),
    ).toBe(false);
    // Suffix-smuggling attempt.
    expect(
      isOriginAllowed(
        'https://life-capital-os-web-git-cla-8a237b-dipankarfin58-8320s-projects.vercel.app.evil.com',
        ALLOWLIST,
        PREVIEW_REGEX,
      ),
    ).toBe(false);
    expect(isOriginAllowed('https://vercel.app', ALLOWLIST, PREVIEW_REGEX)).toBe(false);
    expect(isOriginAllowed('http://evil.com', ALLOWLIST, PREVIEW_REGEX)).toBe(false);
  });

  it('rejects everything unlisted when no preview regex is configured (secure default)', () => {
    expect(
      isOriginAllowed(
        'https://life-capital-os-web-git-cla-8a237b-dipankarfin58-8320s-projects.vercel.app',
        ALLOWLIST,
        null,
      ),
    ).toBe(false);
    expect(isOriginAllowed('https://lifecapitalos.com', ALLOWLIST, null)).toBe(true);
  });
});

describe('parsePreviewOriginRegex', () => {
  it('returns null for unset/blank', () => {
    expect(parsePreviewOriginRegex(undefined)).toBeNull();
    expect(parsePreviewOriginRegex('   ')).toBeNull();
  });

  it('anchors an unanchored pattern so substrings cannot pass', () => {
    const re = parsePreviewOriginRegex('https://foo\\.vercel\\.app');
    expect(re?.test('https://foo.vercel.app')).toBe(true);
    expect(re?.test('https://foo.vercel.app.evil.com')).toBe(false);
    expect(re?.test('https://evil.com/https://foo.vercel.app')).toBe(false);
  });

  it('returns null for an invalid regex instead of throwing', () => {
    expect(parsePreviewOriginRegex('([')).toBeNull();
  });
});

describe('buildCorsOptions', () => {
  it('returns an ARRAY origin (not a callback) so cors always terminates OPTIONS preflights', () => {
    const opts = buildCorsOptions(ALLOWLIST, PREVIEW_REGEX);
    // The regression: a function origin makes cors call next() for disallowed origins,
    // so the OPTIONS preflight falls through to routing and 404s. An array never does.
    expect(Array.isArray(opts.origin)).toBe(true);
    const origin = opts.origin as Array<string | RegExp>;
    expect(origin).toContain('https://lifecapitalos.com');
    expect(origin).toContain('https://www.lifecapitalos.com');
    expect(origin.some((o) => o instanceof RegExp)).toBe(true);
    expect(opts.credentials).toBe(true);
  });

  it('omits the preview regex when none is configured', () => {
    const opts = buildCorsOptions(ALLOWLIST, null);
    const origin = opts.origin as Array<string | RegExp>;
    expect(origin.some((o) => o instanceof RegExp)).toBe(false);
    expect(origin).toEqual([...ALLOWLIST]);
  });
});

/**
 * Integration guard: the ACTUAL preflight behaviour through NestJS `enableCors` + the real
 * `cors` package. Locks in the fix for the Safari "Preflight … Status code: 404" bug — every
 * OPTIONS must resolve to 204 (with ACAO for allowed origins, without for others), NEVER 404.
 */
describe('OPTIONS preflight (NestJS enableCors integration)', () => {
  @Controller()
  class LoginStubController {
    @Post('api/auth/login')
    login() {
      return { ok: true };
    }
  }
  @Module({ controllers: [LoginStubController] })
  class StubModule {}

  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(StubModule, { logger: false });
    app.enableCors(buildCorsOptions(ALLOWLIST, PREVIEW_REGEX));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const preflight = (origin: string) =>
    request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

  it('answers an allowed production origin with 204 + ACAO', async () => {
    const res = await preflight('https://lifecapitalos.com');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://lifecapitalos.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers a Vercel preview origin with 204 + ACAO (the actual fix)', async () => {
    const origin = 'https://life-capital-os-web-git-cla-748423-dipankarfin58-8320s-projects.vercel.app';
    const res = await preflight(origin);
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('answers a DISALLOWED origin with 204 and NO ACAO — never 404', async () => {
    const res = await preflight('https://evil.com');
    expect(res.status).toBe(204); // regression check: was 404 with the function-origin form
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
