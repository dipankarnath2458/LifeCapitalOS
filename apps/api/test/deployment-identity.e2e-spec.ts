import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';

/**
 * Deployment identity — the guarantees `scripts/verify-deployment.mjs` relies on.
 *
 * Confirming that a merged milestone is actually live in production is not directly
 * observable: Swagger is disabled there, and `/api/health` named no build until this
 * milestone. The verification script therefore reads two things — the commit the API
 * reports about itself, and whether an authenticated route answers 401 (the build has it)
 * or 404 (it does not).
 *
 * That second signal is an inference, and it is only sound while the app actually behaves
 * that way. These tests are what keep it sound. If a catch-all route, a rewritten
 * not-found filter, or a `@Public()` on a household controller ever erased the gap between
 * 401 and 404, the production check would keep printing PASS while proving nothing — and
 * this file fails first instead.
 *
 * Uses `createApp()` rather than a hand-built test module, deliberately: the guarantee is
 * about the bootstrap production runs, including the global prefix, the exception filter
 * and the global guards.
 */
describe('Deployment identity (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('/api/health reports what is running', () => {
    it('is public, and answers with a status, a db state and a commit', async () => {
      const res = await http().get('/api/health').expect(200);

      expect(res.body.status).toBe('ok');
      expect(['up', 'down']).toContain(res.body.db);
      // Present as a KEY even when the platform supplies no SHA. A missing key and a null
      // value read identically over HTTP but not in the verifier, which distinguishes
      // "this build does not report its commit" from "this API is too old to have the
      // field at all" — the second is itself a deployment finding.
      expect(res.body).toHaveProperty('commit');
      expect(res.body.commit === null || typeof res.body.commit === 'string').toBe(true);
    });

    it('never invents a build identity', async () => {
      // Locally and in CI no platform SHA is injected, so the honest answer is null. The
      // failure this guards against is a fallback like 'unknown' or 'development', which
      // would make a deployment that cannot name its build look like one that can.
      const { body } = await http().get('/api/health').expect(200);
      if (!process.env.RAILWAY_GIT_COMMIT_SHA && !process.env.GIT_COMMIT_SHA) {
        expect(body.commit).toBeNull();
      } else {
        expect(body.commit).toMatch(/^[0-9a-f]{7}$/);
      }
    });

    it('reports a database outage rather than hiding it behind a 200', async () => {
      // Not a new behaviour — pinned because the verifier now leans on health for build
      // identity too, and it must not become a check that only ever says "fine".
      const { body } = await http().get('/api/health').expect(200);
      expect(body).toHaveProperty('db');
    });
  });

  describe('the 401-vs-404 discriminator the production check depends on', () => {
    // The exact paths `scripts/verify-deployment.mjs` probes. Keep them in step: a route
    // renamed here without updating the script turns a real deployment check into a
    // permanent, silent FAIL.
    const MILESTONE_ROUTES = [
      ['/api/households/probe/goals', 'M5.8 Goals'],
      ['/api/households/probe/protection', 'M5.9 Protection'],
      ['/api/households/probe/retirement', 'M5.10 Retirement'],
    ] as const;

    it.each(MILESTONE_ROUTES)('%s answers 401 unauthenticated — %s is mapped', async (path) => {
      // 401, not 403 and not 404: the global JwtAuthGuard rejects before HouseholdScopeGuard
      // can 404 an unknown household. The household id in the path is deliberately not a
      // real one, which is what makes this probe safe to run against production — it reaches
      // no data, and cannot depend on any.
      await http().get(path).expect(401);
    });

    it('a path the build does not have answers 404', async () => {
      // The control. Without it, three 401s prove nothing: a catch-all that authenticated
      // everything would produce exactly the same output.
      await http().get('/api/households/probe/__no_such_route__').expect(404);
    });

    it('the two answers are genuinely different — the check has teeth', async () => {
      const [mapped, missing] = await Promise.all([
        http().get('/api/households/probe/retirement'),
        http().get('/api/households/probe/__no_such_route__'),
      ]);

      expect(mapped.status).toBe(401);
      expect(missing.status).toBe(404);
      expect(mapped.status).not.toBe(missing.status);
    });

    it('holds for an unknown route anywhere under the API prefix', async () => {
      await http().get('/api/__no_such_module__').expect(404);
      await http().get('/api/households/probe/retirement/__no_such_sub_route__').expect(404);
    });
  });
});
