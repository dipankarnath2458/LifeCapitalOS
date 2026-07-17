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
  it('resolves the origin callback to true/false without throwing', () => {
    const opts = buildCorsOptions(ALLOWLIST, PREVIEW_REGEX);
    const origin = opts.origin as (o: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => void;

    const results: Array<boolean | undefined> = [];
    origin('https://lifecapitalos.com', (_e, ok) => results.push(ok));
    origin('https://evil.com', (_e, ok) => results.push(ok));
    expect(results).toEqual([true, false]);
    expect(opts.credentials).toBe(true);
  });
});
