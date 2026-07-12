import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, type AdminToken } from '../plugins/auth.js';
import { hashPassword, isStrongPassword, verifyPassword } from '../services/password.js';

const strongPasswordSchema = z.string().min(12).max(128).refine(isStrongPassword, {
  message: '密码至少 12 位，且需包含大小写字母、数字和符号'
});

export async function adminRoutes(app: FastifyInstance) {
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(128) }).parse(request.body);
    const admin = await app.prisma.adminUser.findUnique({ where: { username: body.username } });
    if (!admin || !(await verifyPassword(body.password, admin.passwordHash))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: '用户名或密码不正确' } });
    }
    return { token: app.jwt.sign({ aud: 'admin', adminId: admin.id, ver: admin.authVersion }) };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.url.endsWith('/auth/login')) return;
    return requireAuth(request, reply, 'admin');
  });

  app.post('/auth/change-password', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const auth = request.auth as AdminToken;
    const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: strongPasswordSchema }).parse(request.body);
    const admin = await app.prisma.adminUser.findUniqueOrThrow({ where: { id: auth.adminId } });
    if (!(await verifyPassword(body.currentPassword, admin.passwordHash))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: '当前密码不正确' } });
    }
    if (await verifyPassword(body.newPassword, admin.passwordHash)) {
      return reply.code(422).send({ error: { code: 'VALIDATION_FAILED', message: '新密码不能与当前密码相同' } });
    }
    await app.prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(body.newPassword), authVersion: { increment: 1 } }
    });
    return reply.code(204).send();
  });

  app.get('/stats', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [pharmacyTotal, customerTotal, g, b, l, u] = await Promise.all([
      app.prisma.pharmacy.count(),
      app.prisma.pharmacyCustomer.count({ where: { unboundAt: null } }),
      app.prisma.glucoseRecord.count({ where: { measuredAt: { gte: today }, deletedAt: null } }),
      app.prisma.bpRecord.count({ where: { measuredAt: { gte: today }, deletedAt: null } }),
      app.prisma.lipidRecord.count({ where: { measuredAt: { gte: today }, deletedAt: null } }),
      app.prisma.uricRecord.count({ where: { measuredAt: { gte: today }, deletedAt: null } })
    ]);
    return { pharmacyTotal, customerTotal, recordsToday: g + b + l + u };
  });

  app.get('/pharmacies', async () => {
    const pharmacies = await app.prisma.pharmacy.findMany({ include: { staff: true, customers: true } });
    return {
      items: pharmacies.map((pharmacy) => ({
        id: pharmacy.id,
        name: pharmacy.name,
        address: pharmacy.address,
        ownerUsername: pharmacy.staff.find((s) => s.role === 'owner')?.username,
        customerCount: pharmacy.customers.filter((c) => !c.unboundAt).length,
        disabledAt: pharmacy.disabledAt,
        createdAt: pharmacy.createdAt
      }))
    };
  });

  app.post('/pharmacies', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        address: z.string().trim().max(200).default(''),
        phone: z.string().trim().max(30).default(''),
        ownerUsername: z.string().trim().min(3).max(80),
        ownerPassword: strongPasswordSchema
      })
      .parse(request.body);
    return app.prisma.$transaction(async (tx) => {
      const pharmacy = await tx.pharmacy.create({ data: { name: body.name, address: body.address, phone: body.phone } });
      const owner = await tx.pharmacyStaff.create({
        data: {
          pharmacyId: pharmacy.id,
          username: body.ownerUsername,
          name: '店长',
          role: 'owner',
          passwordHash: await hashPassword(body.ownerPassword)
        }
      });
      return { pharmacy, owner: { id: owner.id, username: owner.username } };
    });
  });

  app.patch('/pharmacies/:id', async (request) => {
    const body = z.object({ disabledAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const pharmacyId = String((request.params as any).id);
    return app.prisma.$transaction(async (tx) => {
      const pharmacy = await tx.pharmacy.update({
        where: { id: pharmacyId },
        data: { disabledAt: body.disabledAt ? new Date(body.disabledAt) : null }
      });
      await tx.pharmacyStaff.updateMany({ where: { pharmacyId }, data: { authVersion: { increment: 1 } } });
      return pharmacy;
    });
  });
}
