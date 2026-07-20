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

      // RJ-1 C1: log under `err`, NOT `error` — pino's std serializer only recognises `err`, so
      // `{ error }` serialised to `error={}` and hid every production failure's class/message/stack
      // (this cost a full diagnosis cycle on the invalid-model-output P0). `stage` is set by throwers
      // that know where they failed (StagedError); absent for anything else. The founder-facing
      // response is unchanged — production still masks the message below.
      const stage = (error as { stage?: unknown }).stage;
      logger.warn(
        { err: error, traceId, url: request.url, ...(typeof stage === 'string' ? { stage } : {}) },
        'Request error',
      );

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

      // Trusted framework/client errors carrying a VALID 4xx statusCode (e.g. @fastify/rate-limit → 429,
      // Fastify request validation → 400) keep their status — but with a SAFE, PUBLIC body. The raw
      // error.message is NEVER echoed here (only the trusted DomainError/ApplicationError path above may),
      // so no internal/provider/DB/stack detail leaks. Trust boundary: an integer strictly in 400–499.
      // Anything else (200/302/5xx, non-integer, missing) stays an unclassified 500.
      const statusCode = (error as { statusCode?: unknown }).statusCode;
      if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 499) {
        const is429 = statusCode === 429;
        void reply.status(statusCode).send({
          error: {
            code:       is429 ? 'RATE_LIMIT_EXCEEDED' : 'REQUEST_ERROR',
            message:    is429 ? 'Too many requests. Please slow down and try again.' : 'The request could not be processed.',
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
