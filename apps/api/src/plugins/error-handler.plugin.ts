import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { type Logger, classifyProviderError } from '@bb/infrastructure';
import { DomainError, ApplicationError, InfrastructureError } from '@bb/shared';

/**
 * Global error handler. Maps typed errors to HTTP responses.
 * Never exposes internal details in production.
 * Source: Implementation Spec V1 Section 02.
 */
export function registerErrorHandler(
  server: FastifyInstance,
  logger: Logger,
): void {
  server.setErrorHandler(
    (error: Error, request: FastifyRequest, reply: FastifyReply): void => {
      const traceId   = (request.headers['x-trace-id'] as string | undefined) ?? 'unknown';
      const timestamp = new Date().toISOString();

      // Log under the `err` key (pino's serializer expands Error → name/message/stack). A plain `error` key
      // serialized a standard Error to `{}` (message/stack are non-enumerable), masking real failures.
      logger.warn({ err: error, errMessage: error?.message, errName: error?.name, traceId, url: request.url }, 'Request error');

      const isProd  = process.env['NODE_ENV'] === 'production';
      const message = isProd ? 'An error occurred.' : error.message;

      // Errors we own carry their own code + HTTP status.
      if (error instanceof DomainError || error instanceof ApplicationError || error instanceof InfrastructureError) {
        void reply.status(error.httpStatus).send({
          error: { code: error.code, message, request_id: traceId, timestamp },
        });
        return;
      }

      // A raw LLM-provider (Anthropic SDK) error — give it a granular, diagnostic code instead of an opaque
      // INTERNAL_ERROR, so logs say MODEL_OVERLOADED / MODEL_RATE_LIMITED / … and the web can later tell the
      // founder whether retrying is worth it. HTTP status is deliberately left at 500; status semantics are a
      // separate change. Message masking is unchanged (prod still sends "An error occurred.").
      const provider = classifyProviderError(error);
      if (provider) {
        if (provider.operational) {
          // A rejected API key means nothing in the product can generate until a human fixes it — make it loud.
          logger.error(
            { err: error, errMessage: error?.message, errName: error?.name, traceId, url: request.url, code: provider.code },
            'LLM provider rejected our credentials — generation is DOWN until the API key is restored',
          );
        }
        void reply.status(500).send({
          error: { code: provider.code, message, request_id: traceId, timestamp },
        });
        return;
      }

      void reply.status(500).send({
        error: {
          code:       'INTERNAL_ERROR',
          message,
          request_id: traceId,
          timestamp,
        },
      });
    },
  );
}
