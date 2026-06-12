import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createPrisma } from './plugins/prisma.js';
import { authPlugin } from './plugins/auth.js';
import { appRoutes } from './routes/app.js';
import { pharmacyRoutes } from './routes/pharmacy.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp(options: { prisma?: PrismaClient } = {}) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', options.prisma ?? createPrisma());
  await app.register(cors, { origin: true });
  await app.register(authPlugin);
  await app.register(appRoutes, { prefix: '/api/app' });
  await app.register(pharmacyRoutes, { prefix: '/api/pharmacy' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  app.get('/health', async () => ({ ok: true }));
  await app.ready();
  return app;
}
