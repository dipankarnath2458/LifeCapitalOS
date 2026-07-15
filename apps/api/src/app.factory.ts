import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Express, NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { assertProductionConfig } from './config/configuration';
import { correlationIdMiddleware } from './common/observability/correlation-id.middleware';
import { LoggingInterceptor } from './common/observability/logging.interceptor';
import { AllExceptionsFilter } from './common/observability/all-exceptions.filter';

// Make BigInt serializable in JSON responses.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

/**
 * Minimal security headers, equivalent to the helmet defaults we relied on.
 * Implemented inline because helmet v8 is ESM-only and breaks the CommonJS
 * serverless bundle (require() of an ES module). No dependency, no ESM.
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Build and configure the Nest application without starting an HTTP listener.
 * Shared by the local entrypoint (main.ts) and the Vercel serverless handler so
 * middleware, validation, CORS and Swagger stay identical across environments.
 *
 * Pass an existing Express instance to wrap it (serverless); omit it for local.
 */
export async function createApp(expressInstance?: Express): Promise<INestApplication> {
  // rawBody is needed to verify the Razorpay webhook HMAC against the exact payload.
  const app = expressInstance
    ? await NestFactory.create(AppModule, new ExpressAdapter(expressInstance), { rawBody: true })
    : await NestFactory.create(AppModule, { rawBody: true });

  const config = app.get(ConfigService);

  // Fail fast if a production deploy is still using built-in dev secrets.
  assertProductionConfig({
    nodeEnv: config.get<string>('nodeEnv') ?? 'development',
    jwt: {
      accessSecret: config.get<string>('jwt.accessSecret') ?? '',
      refreshSecret: config.get<string>('jwt.refreshSecret') ?? '',
    },
    encryptionKey: config.get<string>('encryptionKey') ?? '',
  });

  app.setGlobalPrefix('api');
  // Baseline observability: correlation id first, then structured request + error logs.
  app.use(correlationIdMiddleware);
  app.use(securityHeaders);
  app.enableCors({ origin: config.get<string[]>('corsOrigins'), credentials: true });
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Life Capital OS API')
    .setDescription('Wealth Health & Family CFO platform API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  return app;
}
