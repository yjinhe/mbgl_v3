import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { config } from '../env.js';

export type Audience = 'app' | 'pharmacy' | 'admin';

export interface AppToken {
  aud: 'app';
  userId: string;
  ver?: number;
}

export interface PharmacyToken {
  aud: 'pharmacy';
  staffId: string;
  pharmacyId: string;
  role: 'owner' | 'staff';
  ver: number;
}

export interface AdminToken {
  aud: 'admin';
  adminId: string;
  ver: number;
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
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtExpiresIn }
  });
});

function forbidden(reply: FastifyReply, message = 'FORBIDDEN') {
  return reply.code(403).send({ error: { code: 'FORBIDDEN', message } });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply, aud: Audience) {
  try {
    const decoded = await request.jwtVerify<AuthToken>();
    if (decoded.aud !== aud) return forbidden(reply);
    if (decoded.aud === 'app') {
      const user = await request.server.prisma.user.findUnique({ where: { id: decoded.userId } });
      if (!user || user.deactivatedAt || user.authVersion !== (decoded.ver ?? 0)) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' } });
      }
      request.auth = decoded;
    }
    if (decoded.aud === 'pharmacy') {
      const staff = await request.server.prisma.pharmacyStaff.findUnique({
        where: { id: decoded.staffId },
        include: { pharmacy: true }
      });
      if (!staff || staff.disabledAt || staff.pharmacy.disabledAt || staff.authVersion !== decoded.ver) return forbidden(reply);
      if (staff.pharmacyId !== decoded.pharmacyId || (staff.role !== 'owner' && staff.role !== 'staff')) return forbidden(reply);
      request.auth = {
        aud: 'pharmacy',
        staffId: staff.id,
        pharmacyId: staff.pharmacyId,
        role: staff.role,
        ver: staff.authVersion
      };
    }
    if (decoded.aud === 'admin') {
      const admin = await request.server.prisma.adminUser.findUnique({ where: { id: decoded.adminId } });
      if (!admin || admin.authVersion !== decoded.ver) return forbidden(reply);
      request.auth = { aud: 'admin', adminId: admin.id, ver: admin.authVersion };
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
    where: { pharmacyId, userId, unboundAt: null, user: { deactivatedAt: null } }
  });
  return Boolean(binding);
}
