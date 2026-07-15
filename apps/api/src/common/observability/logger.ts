/**
 * Minimal structured (JSON) logger for baseline observability. Dependency-free — emits
 * one JSON object per line to stdout/stderr so a log collector can parse it. Never logs
 * request/response bodies or PII; callers pass only safe fields (ids, method, path,
 * status, duration, correlationId).
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  correlationId?: string;
  [key: string]: unknown;
}

export function logStructured(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}
