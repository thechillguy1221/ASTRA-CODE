import { randomUUID } from 'node:crypto';

const sensitiveKey =
  /(?:api.?key|authorization|password|secret|token|credential|source.?content|raw.?source|private.?key)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : redact(item),
    ]),
  );
}

export class RedactedLogger {
  constructor(private readonly sink: (line: string) => void = (line) => console.log(line)) {}

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.write('info', message, fields);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.write('warn', message, fields);
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.write('error', message, fields);
  }

  private write(level: string, message: string, fields: Record<string, unknown>): void {
    const safeFields = redact(fields);
    const fieldRecord =
      safeFields && typeof safeFields === 'object' && !Array.isArray(safeFields)
        ? (safeFields as Record<string, unknown>)
        : {};
    this.sink(
      JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fieldRecord }),
    );
  }
}

export function createCorrelationId(): string {
  return randomUUID();
}

export interface SupportBundle {
  appVersion: string;
  platform: string;
  diagnostics: Record<string, string | number | boolean | null>;
  errors: string[];
  createdAt: string;
}

export class SupportBundleBuilder {
  build(input: {
    appVersion: string;
    platform: string;
    diagnostics: Record<string, unknown>;
    errors: string[];
  }): SupportBundle {
    const diagnostics: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(input.diagnostics)) {
      if (sensitiveKey.test(key) || key.toLowerCase().includes('source')) continue;
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      )
        diagnostics[key] = value;
    }
    return {
      appVersion: input.appVersion,
      platform: input.platform,
      diagnostics,
      errors: [...input.errors],
      createdAt: new Date().toISOString(),
    };
  }
}
