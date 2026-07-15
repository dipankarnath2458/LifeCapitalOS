import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { logStructured } from './logger';

interface ScopedRequest extends Request {
  correlationId?: string;
  user?: { id?: string };
  firmContext?: { firmId?: string };
}

/**
 * Global error tracking. Logs every unhandled exception as one structured line (with
 * the correlation id) and then returns the **same** response the Nest default filter
 * would — this adds error visibility WITHOUT changing the response envelope (the typed
 * error-envelope is a separate, later item). Backward-compatible by construction.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<ScopedRequest>();
    const res = ctx.getResponse<Response>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Reproduce Nest's default response body exactly (no envelope change).
    let body: unknown;
    if (isHttp) {
      const resp = exception.getResponse();
      body = typeof resp === 'string' ? { statusCode: status, message: resp } : resp;
    } else {
      body = { statusCode: status, message: 'Internal server error' };
    }

    logStructured('error', 'request_error', {
      correlationId: req.correlationId,
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode: status,
      userId: req.user?.id,
      firmId: req.firmContext?.firmId,
      errorName: exception instanceof Error ? exception.name : 'UnknownError',
      errorMessage: exception instanceof Error ? exception.message : String(exception),
      // Stack only for server-side (5xx) failures — client errors are expected.
      ...(status >= 500 && exception instanceof Error ? { stack: exception.stack } : {}),
    });

    res.status(status).json(body);
  }
}
