import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Header carrying the correlation id in and out. */
export const CORRELATION_ID_HEADER = 'x-request-id';

/**
 * Assigns a correlation id to every request: reuses an inbound `x-request-id` (so a
 * trace can span services) or generates one. Exposes it on `req.correlationId` and
 * echoes it back on the response header for client/trace correlation. Additive and
 * side-effect-free beyond the header.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers[CORRELATION_ID_HEADER];
  const id = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim() || randomUUID();
  (req as Request & { correlationId?: string }).correlationId = id;
  res.setHeader(CORRELATION_ID_HEADER, id);
  next();
}
