import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../plugins/auth.js';
import { hashPassword, verifyPassword } from '../services/password.js';

export async function adminRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(request.body);
    const admin = await app.prisma.adminUser.findUnique({ where: { username: body.username } });
    if (!admin || !(await verifyPassword(body.password, admin.passwordHash))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: '用户名或密码不正确' } });
    }
    return { token: app.jwt.sign({ aud: 'admin', adminId: admin.id }) };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.url.endsWith('/auth/login')) return;
    return requireAuth(request, reply, 'admin');
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

  app.post('/pharmacies', async (request) => {
    const body = z
      .object({
        name: z.string(),
        address: z.string().default(''),
        phone: z.string().default(''),
        ownerUsername: z.string(),
        ownerPassword: z.string().min(8)
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
    return app.prisma.pharmacy.update({
      where: { id: String((request.params as any).id) },
      data: { disabledAt: body.disabledAt ? new Date(body.disabledAt) : null }
    });
  });
}
