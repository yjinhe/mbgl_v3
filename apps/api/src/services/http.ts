import type { FastifyReply } from 'fastify';

export function validationError(reply: FastifyReply, message = 'VALIDATION_FAILED', fields?: unknown) {
  return reply.code(422).send({ error: { code: 'VALIDATION_FAILED', message, fields } });
}

export function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'FORBIDDEN' } });
}

export function notFound(reply: FastifyReply, message = 'NOT_FOUND') {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message } });
}

export function conflict(reply: FastifyReply, code = 'CONFLICT', message = code) {
  return reply.code(409).send({ error: { code, message } });
}
