import { trace, type Tracer, type Span, SpanStatusCode } from '@opentelemetry/api';

const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] ?? 'bb-service';

/**
 * Returns the OpenTelemetry tracer for this service.
 * Source: Implementation Spec V1 Section 07.
 */
export function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME);
}

/**
 * Wraps an async operation in an OTel span.
 * Sets span attributes and records errors automatically.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span: Span) => {
    span.setAttributes(attributes);
    try {
      const result = await work(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code:    SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}
