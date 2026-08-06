#!/usr/bin/env node
/**
 * Deployment verification — checks a LIVE environment from the outside.
 *
 * Every production incident this project has had was a configuration problem that the
 * health check could not see: CORS missing the caller's origin, preflights 404ing, the web
 * bundle built against the wrong API URL, the seed never run. The API reported healthy
 * throughout. This script checks the things that actually broke.
 *
 * Usage:
 *   node scripts/verify-deployment.mjs \
 *     --api https://lifecapitalos-api-production.up.railway.app \
 *     --web https://lifecapitalos.com
 *
 * Exits non-zero if any FAIL is recorded. WARNs do not fail the run.
 * Read-only: it sends no request that creates data or sends email.
 */

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const API = (arg('api') ?? process.env.VERIFY_API_URL ?? '').replace(/\/+$/, '');
const WEB = (arg('web') ?? process.env.VERIFY_WEB_URL ?? '').replace(/\/+$/, '');
const EXPECT_PROD = arg('env', 'production') === 'production';

if (!API || !WEB) {
  console.error('Usage: node scripts/verify-deployment.mjs --api <api-origin> --web <web-origin>');
  process.exit(2);
}

let fails = 0;
let warns = 0;
const pass = (m, d = '') => console.log(`  PASS  ${m}${d ? ` — ${d}` : ''}`);
const fail = (m, d = '') => {
  console.log(`  FAIL  ${m}${d ? ` — ${d}` : ''}`);
  fails++;
};
const warn = (m, d = '') => {
  console.log(`  WARN  ${m}${d ? ` — ${d}` : ''}`);
  warns++;
};
const section = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

async function get(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Verifying deployment\n  API: ${API}\n  WEB: ${WEB}`);

/* ------------------------------------------------------------------ API health */
section('API health');
let health;
try {
  const res = await get(`${API}/api/health`);
  health = res.ok ? await res.json() : null;
  if (!res.ok) fail('GET /api/health', `HTTP ${res.status}`);
  else if (health?.status !== 'ok') fail('health status', JSON.stringify(health));
  else pass('GET /api/health', `status=${health.status}`);

  if (health && health.db !== 'up') fail('database reachable from the API', `db=${health.db}`);
  else if (health) pass('database reachable from the API');
} catch (err) {
  fail('GET /api/health', err.message);
}

/* ------------------------------------------------------- security headers */
section('Security headers');
try {
  const res = await get(`${API}/api/health`);
  const required = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  };
  for (const [header, expected] of Object.entries(required)) {
    const actual = res.headers.get(header);
    if (actual?.toLowerCase() === expected.toLowerCase()) pass(header, actual);
    else fail(header, `expected "${expected}", got ${actual ?? 'nothing'}`);
  }
  const hsts = res.headers.get('strict-transport-security');
  if (hsts) pass('strict-transport-security', hsts);
  else warn('strict-transport-security', 'missing');

  const powered = res.headers.get('x-powered-by');
  if (powered) warn('x-powered-by is disclosed', powered);
  else pass('x-powered-by is not disclosed');
} catch (err) {
  fail('security headers', err.message);
}

/* -------------------------------------------------------------------- CORS */
section('CORS (the failure that cost two production outages)');
async function preflight(origin) {
  return get(`${API}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
}
try {
  const res = await preflight(WEB);
  const acao = res.headers.get('access-control-allow-origin');
  // A 404 here is the specific bug that broke Safari logins: `cors` skips terminating the
  // preflight when the origin option is a callback, so it falls through to routing.
  if (res.status === 404) fail('preflight from the web origin', 'HTTP 404 — preflight not terminated');
  else if (![200, 204].includes(res.status)) fail('preflight from the web origin', `HTTP ${res.status}`);
  else if (acao !== WEB) fail('Access-Control-Allow-Origin', `expected "${WEB}", got ${acao ?? 'nothing'}`);
  else pass('preflight from the web origin', `${res.status} + ACAO`);

  if (res.headers.get('access-control-allow-credentials') === 'true') pass('credentials allowed');
  else warn('access-control-allow-credentials', 'not set — the browser will drop the auth header');
} catch (err) {
  fail('preflight from the web origin', err.message);
}

try {
  const res = await preflight('https://not-your-app.example.com');
  const acao = res.headers.get('access-control-allow-origin');
  if (acao === '*') fail('wildcard CORS with credentials', 'ACAO is "*" — never valid here');
  else if (acao) fail('an unlisted origin was allowed', `ACAO=${acao}`);
  else if (res.status === 404) fail('preflight from an unlisted origin', 'HTTP 404 — should be 204 without ACAO');
  else pass('an unlisted origin is rejected', `${res.status}, no ACAO`);
} catch (err) {
  fail('preflight from an unlisted origin', err.message);
}

/* ----------------------------------------------------------- API surface */
section('API surface');
try {
  const res = await get(`${API}/api/docs`);
  if (res.status === 404) pass('Swagger is not exposed');
  else if (EXPECT_PROD)
    warn('Swagger is publicly exposed', `HTTP ${res.status} at /api/docs — unset SWAGGER_ENABLED in production`);
  else pass('Swagger reachable (non-production)', `HTTP ${res.status}`);
} catch (err) {
  warn('/api/docs', err.message);
}

/* ------------------------------------------------------------- web app */
section('Web app');
try {
  const res = await get(`${WEB}/`);
  if (res.ok) pass('GET / on the web app', `HTTP ${res.status}`);
  else fail('GET / on the web app', `HTTP ${res.status}`);

  const login = await get(`${WEB}/login`);
  if (login.ok) pass('GET /login');
  else fail('GET /login', `HTTP ${login.status}`);

  const forgot = await get(`${WEB}/forgot-password`);
  if (forgot.ok) pass('GET /forgot-password (account recovery reachable)');
  else fail('GET /forgot-password', `HTTP ${forgot.status}`);
} catch (err) {
  fail('web app', err.message);
}

/* --------------------------------------- the build-time inlining trap */
section('Web bundle points at the right API');
// NEXT_PUBLIC_API_URL is inlined at BUILD time. Changing it in the dashboard without a
// redeploy silently leaves the old value baked into the bundle — which is how a preview
// ended up calling http://localhost:4000. Read it back out of the shipped JavaScript.
try {
  const html = await (await get(`${WEB}/login`)).text();
  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+?\.js/g)].map((m) => m[0]);
  let found = null;
  for (const chunk of [...new Set(chunks)].slice(0, 25)) {
    const js = await (await get(`${WEB}${chunk}`)).text();
    const hit = js.match(/https?:\/\/[a-zA-Z0-9.\-:]+\/api(?=["'`])/);
    if (hit) {
      found = hit[0];
      break;
    }
  }
  if (!found) warn('could not locate the API URL in the bundle', 'checked the first 25 chunks');
  else if (found.startsWith(API)) pass('bundle calls the expected API', found);
  else fail('bundle calls the WRONG API', `baked in: ${found} — redeploy the web app`);
} catch (err) {
  warn('bundle inspection', err.message);
}

/* ------------------------------------------------------------------ done */
section('Result');
console.log(`  ${fails} failed, ${warns} warning(s)`);
if (fails > 0) {
  console.log('\nDeployment verification FAILED.');
  process.exit(1);
}
console.log('\nDeployment verification passed.');
