import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { config } from '../env.js';

export type Audience = 'app' | 'pharmacy' | 'admin';

export interface AppToken {
  aud: 'app';
  userId: string;
}

export interface PharmacyToken {
  aud: 'pharmacy';
  staffId: string;
  pharmacyId: string;
  role: 'owner' | 'staff';
}

export interface AdminToken {
  aud: 'admin';
  adminId: string;
}

export type AuthToken = AppToken | PharmacyToken | AdminToken;

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    auth?: AuthToken;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(jwt, { secret: config.jwtSecret });
});

function forbidden(reply: FastifyReply, message = 'FORBIDDEN') {
  return reply.code(403).send({ error: { code: 'FORBIDDEN', message } });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply, aud: Audience) {
  try {
    const decoded = await request.jwtVerify<AuthToken>();
    if (decoded.aud !== aud) return forbidden(reply);
    request.auth = decoded;
    if (decoded.aud === 'app') {
      const user = await request.server.prisma.user.findUnique({ where: { id: decoded.userId } });
      if (!user || user.deactivatedAt) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' } });
    }
    if (decoded.aud === 'pharmacy') {
      const staff = await request.server.prisma.pharmacyStaff.findUnique({
        where: { id: decoded.staffId },
        include: { pharmacy: true }
      });
      if (!staff || staff.disabledAt || staff.pharmacy.disabledAt) return forbidden(reply);
    }
    if (decoded.aud === 'admin') {
      const admin = await request.server.prisma.adminUser.findUnique({ where: { id: decoded.adminId } });
      if (!admin) return forbidden(reply);
    }
  } catch {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' } });
  }
}

export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.auth;
  if (!auth || auth.aud !== 'pharmacy' || auth.role !== 'owner') return forbidden(reply);
}

export async function assertActiveCustomer(
  app: FastifyInstance,
  pharmacyId: string,
  userId: string
): Promise<boolean> {
  const binding = await app.prisma.pharmacyCustomer.findFirst({
    where: { pharmacyId, userId, unboundAt: null }
  });
  return Boolean(binding);
}
