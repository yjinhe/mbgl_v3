import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { config } from './env.js';
import { createPrisma } from './plugins/prisma.js';
import { authPlugin } from './plugins/auth.js';
import { appRoutes } from './routes/app.js';
import { pharmacyRoutes } from './routes/pharmacy.js';
import { adminRoutes } from './routes/admin.js';
import { proxyTrust } from './services/proxy-trust.js';

export async function buildApp(options: { prisma?: PrismaClient } = {}) {
  const ownsPrisma = !options.prisma;
  const prisma = options.prisma ?? createPrisma();
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: config.nodeEnv === 'test' ? false : {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.headers.authorization',
          '*.secret',
          '*.session_key',
          '*.access_token',
          '*.refresh_token'
        ],
        censor: '[REDACTED]'
      }
    },
    trustProxy: proxyTrust(config.trustProxyHops)
  });
  app.decorate('prisma', prisma);
  await app.register(helmet);
  await app.register(rateLimit, {
    global: true,
    max: config.globalRateLimit,
    timeWindow: '1 minute'
  });
  await app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin(origin, callback) {
      callback(null, !origin || config.corsOrigins.includes(origin));
    }
  });
  await app.register(authPlugin);

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/') || request.url === '/health') {
      reply.header('cache-control', 'private, no-store, max-age=0');
      reply.header('pragma', 'no-cache');
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: { code: 'VALIDATION_FAILED', message: '请求参数不正确', fields: error.flatten().fieldErrors }
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.code(409).send({ error: { code: 'CONFLICT', message: '数据已存在' } });
      }
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '数据不存在' } });
      }
    }
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
    if (statusCode && statusCode < 500) {
      const code = statusCode === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED';
      const message = error instanceof Error ? error.message : '请求失败';
      return reply.code(statusCode).send({ error: { code, message } });
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } });
  });

  await app.register(appRoutes, { prefix: '/api/app' });
  await app.register(pharmacyRoutes, { prefix: '/api/pharmacy' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { ok: true, version: config.appVersion, buildSha: config.buildSha };
    } catch (error) {
      app.log.error({ err: error }, 'database health check failed');
      return reply.code(503).send({ ok: false });
    }
  });
  if (ownsPrisma) {
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }
  await app.ready();
  return app;
}
