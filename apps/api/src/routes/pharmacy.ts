import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../env.js';
import { assertActiveCustomer, requireAuth, requireOwner, type PharmacyToken } from '../plugins/auth.js';
import { forbidden, notFound, validationError } from '../services/http.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { METRICS, serializeRecord, statsForMetric } from '../services/records.js';
import type { Metric } from '@tangji/shared';

const metricSchema = z.enum(['glucose', 'bp', 'lipid', 'uric']);

export async function pharmacyRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(request.body);
    const staff = await app.prisma.pharmacyStaff.findUnique({ where: { username: body.username }, include: { pharmacy: true } });
    if (!staff || staff.disabledAt || staff.pharmacy.disabledAt || !(await verifyPassword(body.password, staff.passwordHash))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: '用户名或密码不正确' } });
    }
    const token = app.jwt.sign({
      aud: 'pharmacy',
      staffId: staff.id,
      pharmacyId: staff.pharmacyId,
      role: staff.role
    });
    return { token, staff: { name: staff.name, role: staff.role }, pharmacy: { name: staff.pharmacy.name } };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.url.endsWith('/auth/login')) return;
    return requireAuth(request, reply, 'pharmacy');
  });

  app.get('/dashboard', async (request) => {
    const auth = request.auth as PharmacyToken;
    const activeBindings = await app.prisma.pharmacyCustomer.findMany({
      where: { pharmacyId: auth.pharmacyId, unboundAt: null },
      include: { user: true, inviteCode: true }
    });
    const alerts = await alertsForPharmacy(app, auth.pharmacyId, 7);
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const activeIn7d = (await Promise.all(activeBindings.map((b) => lastRecord(app, b.userId)))).filter(
      (record) => record && record.measuredAt >= weekAgo
    ).length;
    return {
      customerTotal: activeBindings.length,
      weekNew: activeBindings.filter((b) => b.consentAt >= weekAgo).length,
      activeIn7d,
      pendingAlerts: alerts.filter((a) => !a.followUp).length,
      latestAlerts: alerts.slice(0, 5),
      latestBindings: activeBindings
        .sort((a, b) => b.consentAt.getTime() - a.consentAt.getTime())
        .slice(0, 5)
        .map((b) => ({ userId: b.userId, nickname: b.user.nickname, boundAt: b.consentAt.toISOString() }))
    };
  });

  app.get('/customers', async (request) => {
    const auth = request.auth as PharmacyToken;
    const query = z.object({ search: z.string().optional(), filter: z.enum(['all', 'alert', 'inactive7d']).default('all') }).parse(request.query);
    const bindings = await app.prisma.pharmacyCustomer.findMany({
      where: { pharmacyId: auth.pharmacyId, unboundAt: null },
      include: { user: true },
      orderBy: { consentAt: 'desc' }
    });
    const alertIds = new Set((await alertsForPharmacy(app, auth.pharmacyId, 7)).map((a) => a.customer.userId));
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const items = [];
    for (const binding of bindings) {
      if (query.search && !binding.user.nickname.includes(query.search)) continue;
      const latest = await latestByMetric(app, binding.userId, binding.user);
      const last = Object.entries(latest)
        .map(([metric, record]) => (record ? { metric, record } : null))
        .filter(Boolean)
        .sort((a: any, b: any) => new Date(b.record.measuredAt).getTime() - new Date(a.record.measuredAt).getTime())[0] as any;
      if (query.filter === 'alert' && !alertIds.has(binding.userId)) continue;
      if (query.filter === 'inactive7d' && new Date(last?.record?.measuredAt ?? 0) >= weekAgo) continue;
      items.push({
        userId: binding.userId,
        nickname: binding.user.nickname,
        sex: binding.user.sex,
        boundAt: binding.consentAt.toISOString(),
        lastRecordAt: last?.record?.measuredAt ?? null,
        lastRecordMetric: last?.metric ?? null,
        dots: Object.fromEntries(METRICS.map((metric) => [metric, latest[metric]?.status.key ?? null]))
      });
    }
    return { items, nextCursor: null };
  });

  app.get('/customers/:userId', async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    const userId = String((request.params as any).userId);
    if (!(await assertActiveCustomer(app, auth.pharmacyId, userId))) return forbidden(reply);
    await app.prisma.pharmacyAccessLog.create({ data: { pharmacyId: auth.pharmacyId, staffId: auth.staffId, userId, action: 'view_customer' } });
    const binding = await app.prisma.pharmacyCustomer.findFirst({ where: { pharmacyId: auth.pharmacyId, userId, unboundAt: null }, include: { user: true } });
    const alerts = await alertsForPharmacy(app, auth.pharmacyId, 7);
    return {
      userId,
      nickname: binding?.user.nickname,
      sex: binding?.user.sex,
      boundAt: binding?.consentAt.toISOString(),
      pendingAlerts: alerts.filter((a) => a.customer.userId === userId && !a.followUp).length
    };
  });

  app.get('/customers/:userId/records', async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    const userId = String((request.params as any).userId);
    const query = z.object({ metric: metricSchema }).parse(request.query);
    if (!(await assertActiveCustomer(app, auth.pharmacyId, userId))) return forbidden(reply);
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const records = await recordsForMetric(app, query.metric, userId);
    return { items: records.map((record) => serializeRecord(query.metric, record, user)), nextCursor: null };
  });

  app.get('/customers/:userId/stats', async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    const userId = String((request.params as any).userId);
    const query = z.object({ metric: metricSchema, range: z.coerce.number().default(7) }).parse(request.query);
    if (!(await assertActiveCustomer(app, auth.pharmacyId, userId))) return forbidden(reply);
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return statsForMetric(app.prisma, userId, user, query.metric, query.range);
  });

  app.get('/alerts', async (request) => {
    const auth = request.auth as PharmacyToken;
    const query = z
      .object({
        days: z.coerce.number().default(7),
        metric: z.union([metricSchema, z.literal('all')]).default('all'),
        status: z.enum(['pending', 'done', 'all']).default('pending')
      })
      .parse(request.query);
    let items = await alertsForPharmacy(app, auth.pharmacyId, query.days);
    if (query.metric !== 'all') items = items.filter((item) => item.metric === query.metric);
    if (query.status === 'pending') items = items.filter((item) => !item.followUp);
    if (query.status === 'done') items = items.filter((item) => item.followUp);
    return { items };
  });

  app.post('/alerts/follow-up', async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    const body = z.object({ metric: metricSchema, recordId: z.string(), note: z.string().max(100).optional() }).parse(request.body);
    const ownerUserId = await ownerOfRecord(app, body.metric, body.recordId);
    if (!ownerUserId || !(await assertActiveCustomer(app, auth.pharmacyId, ownerUserId))) return forbidden(reply);
    const followUp = await app.prisma.followUp.upsert({
      where: { pharmacyId_metric_recordId: { pharmacyId: auth.pharmacyId, metric: body.metric, recordId: body.recordId } },
      update: {},
      create: { pharmacyId: auth.pharmacyId, staffId: auth.staffId, metric: body.metric, recordId: body.recordId, note: body.note ?? '' }
    });
    return { followUp };
  });

  app.post('/invites', async (request) => {
    const auth = request.auth as PharmacyToken;
    const code = await uniqueInviteCode(app);
    const invite = await app.prisma.inviteCode.create({
      data: {
        pharmacyId: auth.pharmacyId,
        staffId: auth.staffId,
        code,
        expiresAt: new Date(Date.now() + 30 * 86400000)
      }
    });
    return { code, expiresAt: invite.expiresAt.toISOString(), qrContent: `${config.webOrigin}/bind-pharmacy?code=${code}` };
  });

  app.get('/invites', async (request) => {
    const auth = request.auth as PharmacyToken;
    const invites = await app.prisma.inviteCode.findMany({ where: { pharmacyId: auth.pharmacyId }, orderBy: { createdAt: 'desc' } });
    const items = await Promise.all(
      invites.map(async (invite) => ({
        id: invite.id,
        code: invite.code,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt.toISOString(),
        disabledAt: invite.disabledAt?.toISOString() ?? null,
        boundCount: await app.prisma.pharmacyCustomer.count({ where: { inviteCodeId: invite.id, unboundAt: null } })
      }))
    );
    return { items };
  });

  app.patch('/invites/:id', async (request) => {
    const auth = request.auth as PharmacyToken;
    const body = z.object({ disabled: z.boolean() }).parse(request.body);
    return app.prisma.inviteCode.update({
      where: { id: String((request.params as any).id), pharmacyId: auth.pharmacyId } as any,
      data: { disabledAt: body.disabled ? new Date() : null }
    });
  });

  app.get('/profile', async (request) => {
    const auth = request.auth as PharmacyToken;
    return app.prisma.pharmacy.findUnique({ where: { id: auth.pharmacyId } });
  });

  app.patch('/profile', async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    await requireOwner(request, reply);
    const body = z.object({ name: z.string().optional(), address: z.string().optional(), phone: z.string().optional() }).parse(request.body);
    return app.prisma.pharmacy.update({ where: { id: auth.pharmacyId }, data: body });
  });

  app.get('/staff', async (request, reply) => {
    await requireOwner(request, reply);
    const auth = request.auth as PharmacyToken;
    return { items: await app.prisma.pharmacyStaff.findMany({ where: { pharmacyId: auth.pharmacyId } }) };
  });

  app.post('/staff', async (request, reply) => {
    await requireOwner(request, reply);
    const auth = request.auth as PharmacyToken;
    const body = z.object({ username: z.string(), name: z.string(), password: z.string().min(8), role: z.enum(['owner', 'staff']).default('staff') }).parse(request.body);
    return app.prisma.pharmacyStaff.create({
      data: { pharmacyId: auth.pharmacyId, username: body.username, name: body.name, role: body.role, passwordHash: await hashPassword(body.password) }
    });
  });

  app.patch('/staff/:id', async (request, reply) => {
    await requireOwner(request, reply);
    const auth = request.auth as PharmacyToken;
    const id = String((request.params as any).id);
    if (id === auth.staffId) return validationError(reply, '不可停用自己');
    const body = z.object({ disabledAt: z.string().datetime().nullable().optional() }).parse(request.body);
    return app.prisma.pharmacyStaff.update({ where: { id }, data: { disabledAt: body.disabledAt ? new Date(body.disabledAt) : null } });
  });
}

async function uniqueInviteCode(app: FastifyInstance) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const exists = await app.prisma.inviteCode.findUnique({ where: { code } });
    if (!exists) return code;
  }
}

async function recordsForMetric(app: FastifyInstance, metric: Metric, userId: string) {
  if (metric === 'glucose') return app.prisma.glucoseRecord.findMany({ where: { userId, deletedAt: null }, orderBy: { measuredAt: 'desc' } });
  if (metric === 'bp') return app.prisma.bpRecord.findMany({ where: { userId, deletedAt: null }, orderBy: { measuredAt: 'desc' } });
  if (metric === 'lipid') return app.prisma.lipidRecord.findMany({ where: { userId, deletedAt: null }, orderBy: { measuredAt: 'desc' } });
  return app.prisma.uricRecord.findMany({ where: { userId, deletedAt: null }, orderBy: { measuredAt: 'desc' } });
}

async function latestByMetric(app: FastifyInstance, userId: string, user: any) {
  const latest = await Promise.all(METRICS.map(async (metric) => [metric, (await recordsForMetric(app, metric, userId))[0]] as const));
  return Object.fromEntries(latest.map(([metric, record]) => [metric, record ? serializeRecord(metric, record, user) : null])) as Record<Metric, any>;
}

async function lastRecord(app: FastifyInstance, userId: string) {
  const rows = await Promise.all(METRICS.map(async (metric) => (await recordsForMetric(app, metric, userId))[0] ?? null));
  return rows.filter(Boolean).sort((a: any, b: any) => b.measuredAt.getTime() - a.measuredAt.getTime())[0] ?? null;
}

async function ownerOfRecord(app: FastifyInstance, metric: Metric, recordId: string) {
  const rows = await recordsForMetricRaw(app, metric, { id: recordId });
  return rows[0]?.userId ?? null;
}

async function recordsForMetricRaw(app: FastifyInstance, metric: Metric, where: any) {
  if (metric === 'glucose') return app.prisma.glucoseRecord.findMany({ where });
  if (metric === 'bp') return app.prisma.bpRecord.findMany({ where });
  if (metric === 'lipid') return app.prisma.lipidRecord.findMany({ where });
  return app.prisma.uricRecord.findMany({ where });
}

async function alertsForPharmacy(app: FastifyInstance, pharmacyId: string, days: number) {
  const since = new Date(Date.now() - days * 86400000);
  const bindings = await app.prisma.pharmacyCustomer.findMany({ where: { pharmacyId, unboundAt: null }, include: { user: true } });
  const items: any[] = [];
  for (const binding of bindings) {
    for (const metric of METRICS) {
      for (const record of await recordsForMetric(app, metric, binding.userId)) {
        if (record.measuredAt < since) continue;
        const serialized = serializeRecord(metric, record, binding.user);
        if (serialized.status.key !== 'dhigh' && serialized.status.key !== 'dlow') continue;
        const followUp = await app.prisma.followUp.findUnique({ where: { pharmacyId_metric_recordId: { pharmacyId, metric, recordId: record.id } } });
        items.push({
          metric,
          record: serialized,
          customer: { userId: binding.userId, nickname: binding.user.nickname },
          followUp,
          occurredAt: record.measuredAt.toISOString()
        });
      }
    }
  }
  return items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}
