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

      // TEMP DIAGNOSTIC: the raw Error serializes to {} (non-enumerable name/message/stack), which
      // hides the real failure. Log EXPLICIT STRING fields instead. No secrets are in scope here
      // (never the password, hash, token, or key). Revert to the one-line form after triage.
      const e = error as { name?: string; message?: string; stack?: string; code?: string | number };
      logger.warn({
        err_name:    typeof e?.name === 'string' ? e.name : 'unknown',
        err_message: typeof e?.message === 'string' ? e.message : 'unknown',
        err_code:    e?.code ?? null,
        err_stack:   (typeof e?.stack === 'string' ? e.stack : '').split('\n').slice(0, 12).join(' | '),
        traceId,
        url: request.url,
      }, 'Request error');

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
