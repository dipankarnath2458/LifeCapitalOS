import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { logStructured } from './logger';

interface ScopedRequest extends Request {
  correlationId?: string;
  user?: { id?: string };
  firmContext?: { firmId?: string };
}

/**
 * Logs one structured line per successfully-handled request (method, path, status,
 * duration, correlationId, and — when the guard has resolved them — userId/firmId).
 * Errors are logged by the global exception filter instead, to avoid double logging.
 * No bodies, no PII.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<ScopedRequest>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    return next.handle().pipe(
      tap(() => {
        logStructured('info', 'request', {
          correlationId: req.correlationId,
          method: req.method,
          path: req.originalUrl ?? req.url,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
          userId: req.user?.id,
          firmId: req.firmContext?.firmId,
        });
      }),
    );
  }
}
