import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from '@bb/infrastructure';
import { DomainError, ApplicationError } from '@bb/shared';

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

      if (error instanceof DomainError || error instanceof ApplicationError) {
        void reply.status(error.httpStatus).send({
          error: {
            code:       error.code,
            message,
            request_id: traceId,
            timestamp,
          },
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
