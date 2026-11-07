import type { LogRecord } from '@photoarchive/shared';
import type { AppDatabase } from './database.js';

export class Logger {
  constructor(
    private readonly db: AppDatabase,
    private readonly minLevel: LogRecord['level'] = 'info'
  ) {}

  debug(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('debug', scope, message, context);
  }

  info(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('info', scope, message, context);
  }

  warn(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('warn', scope, message, context);
  }

  error(scope: string, message: string, context?: Record<string, unknown>): void {
    this.write('error', scope, message, context);
  }

  private write(level: LogRecord['level'], scope: string, message: string, context?: Record<string, unknown>): void {
    const priority: Record<LogRecord['level'], number> = { debug: 10, info: 20, warn: 30, error: 40 };
    if (priority[level] < priority[this.minLevel]) return;
    const payload = context ? sanitizeContext(context) : undefined;
    this.db.log(level, scope, message, payload);
    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
    if (level === 'error') console.error(line, payload ?? '');
    else if (level === 'warn') console.warn(line, payload ?? '');
    else console.log(line, payload ?? '');
  }
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...context };
  for (const [key, value] of Object.entries(clone)) {
    if (/token|secret|password|api.?key/i.test(key)) clone[key] = '<redacted>';
    else if (typeof value === 'string' && value.length > 2000) clone[key] = `${value.slice(0, 2000)}…`;
  }
  return clone;
}
