import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * End-to-end smoke test for the public Wealth Tools + auth surface. Requires a
 * running PostgreSQL (DATABASE_URL) with migrations applied. Skipped if no DB.
 */
describe('API e2e (smoke)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/tools/health-check returns a wealth score', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tools/health-check')
      .send({
        age: 35,
        monthlyExpensesMinor: 5000000,
        emergencyFundMinor: 15000000,
        annualIncomeMinor: 200000000,
        existingLifeCoverMinor: 50000000,
        hasHealthInsurance: true,
        investmentAssetsMinor: 100000000,
        totalAssetsMinor: 1000000000,
        totalLiabilitiesMinor: 300000000,
      });
    expect(res.status).toBe(201);
    expect(res.body.report.overall).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.topActions)).toBe(true);
  });

  it('rejects protected routes without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/accounts');
    expect(res.status).toBe(401);
  });
});
