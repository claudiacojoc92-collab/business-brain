import pino from 'pino';

const PII_PATHS = [
  'email',
  'name',
  'business_name',
  '*.email',
  '*.name',
  'body.value',
];

/**
 * Structured JSON logger using pino.
 * PII fields are redacted in all environments.
 * Source: Implementation Spec V1 Section 06.
 */
export function createLogger(options?: {
  level?: string;
  service?: string;
  pretty?: boolean;
}): pino.Logger {
  const level   = options?.level   ?? process.env['LOG_LEVEL'] ?? 'info';
  const service = options?.service ?? process.env['OTEL_SERVICE_NAME'] ?? 'bb-service';
  const pretty  = options?.pretty  ?? process.env['NODE_ENV'] === 'development';

  return pino({
    level,
    redact: {
      paths:   PII_PATHS,
      censor:  '[REDACTED]',
    },
    base: { service },
    transport: pretty
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
}

export type Logger = pino.Logger;
