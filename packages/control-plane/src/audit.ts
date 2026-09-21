import type { AuditEventInput } from './contracts.js';

const sensitiveKeyPattern = /(password|secret|token|api[_-]?key|private[_-]?key|credential|authorization|cookie|jwt)/i;

export function redactAuditState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactAuditState(entry));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactAuditState(entry);
  }
  return result;
}

export function redactAuditEvent(event: AuditEventInput): AuditEventInput {
  return {
    ...event,
    before: redactAuditState(event.before),
    after: redactAuditState(event.after),
  };
}
