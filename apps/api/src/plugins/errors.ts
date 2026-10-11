import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError, ERROR_CODES, type ApiFailure, type ErrorCode } from '@nexora/shared';

const fail = (code: ErrorCode, message?: string, details?: unknown): ApiFailure => ({
  ok: false,
  error: { code, message: message ?? ERROR_CODES[code].message, ...(details === undefined ? {} : { details }) },
});

export default fp(async (app) => {
  app.setNotFoundHandler((_req, reply) => reply.code(404).send(fail('INTERNAL', 'Route not found.')));

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send(fail(err.code, err.message, err.details));

    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.code(400).send(fail('VALIDATION_ERROR', details[0]?.message ?? undefined, details));
    }
    if (err.statusCode === 429) return reply.code(429).send(fail('RATE_LIMITED'));
    switch (err.code) {
      case 'FST_REQ_FILE_TOO_LARGE': return reply.code(413).send(fail('FILE_TOO_LARGE'));
      case 'FST_FILES_LIMIT': return reply.code(400).send(fail('TOO_MANY_FILES'));
      case 'FST_INVALID_MULTIPART_CONTENT_TYPE': return reply.code(400).send(fail('EMPTY_UPLOAD'));
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send(fail('VALIDATION_ERROR', 'The request could not be understood.'));
    }
    // Technical detail goes to the log only, never to the client.
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(fail('INTERNAL'));
  });
});
