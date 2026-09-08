import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { config } from '../env.js';
import { assertActiveCustomer, requireAuth, requireOwner, type PharmacyToken } from '../plugins/auth.js';
import { forbidden, notFound, validationError } from '../services/http.js';
import { hashPassword, isStrongPassword, verifyPassword } from '../services/password.js';
import { METRICS, serializeRecord, statsForMetric } from '../services/records.js';
import type { Metric } from '@tangji/shared';

const metricSchema = z.enum(['glucose', 'bp', 'lipid', 'uric']);
const strongPasswordSchema = z.string().min(12).max(128).refine(isStrongPassword, {
  message: '密码至少 12 位，且需包含大小写字母、数字和符号'
});
const publicStaffSelect = {
  id: true,
  pharmacyId: true,
  username: true,
  name: true,
  role: true,
  disabledAt: true,
  createdAt: true
} as const;

export async function pharmacyRoutes(app: FastifyInstance) {
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(128) }).parse(request.body);
    const staff = await app.prisma.pharmacyStaff.findUnique({ where: { username: body.username }, include: { pharmacy: true } });
    if (!staff || staff.disabledAt || staff.pharmacy.disabledAt || !(await verifyPassword(body.password, staff.passwordHash))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: '用户名或密码不正确' } });
    }
    const token = app.jwt.sign({
      aud: 'pharmacy',
      staffId: staff.id,
      pharmacyId: staff.pharmacyId,
      role: staff.role,
      ver: staff.authVersion
    });
    return { token, staff: { name: staff.name, role: staff.role }, pharmacy: { name: staff.pharmacy.name } };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'POST' && request.routeOptions.url === '/api/pharmacy/auth/login') return;
    return requireAuth(request, reply, 'pharmacy');
  });

  app.post('/auth/change-password', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: strongPasswordSchema }).parse(request.body);
    const staff = await app.prisma.pharmacyStaff.findUniqueOrThrow({ where: { id: auth.staffId } });
    if (!(await verifyPassword(body.currentPassword, staff.passwordHash))) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: '当前密码不正确' } });
    }
    if (await verifyPassword(body.newPassword, staff.passwordHash)) {
      return reply.code(422).send({ error: { code: 'VALIDATION_FAILED', message: '新密码不能与当前密码相同' } });
    }
    await app.prisma.pharmacyStaff.update({
      where: { id: staff.id },
      data: { passwordHash: await hashPassword(body.newPassword), authVersion: { increment: 1 } }
    });
    return reply.code(204).send();
  });

  app.get('/dashboard', async (request) => {
    const auth = request.auth as PharmacyToken;
    const activeBindings = await app.prisma.pharmacyCustomer.findMany({
      where: { pharmacyId: auth.pharmacyId, unboundAt: null, user: { deactivatedAt: null } },
      include: { user: true, inviteCode: true }
    });
    const alerts = await alertsForPharmacy(app, auth.pharmacyId, 7);
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const activeUserIds = await activeUsersSince(app, activeBindings.map((binding) => binding.userId), weekAgo);
    return {
      customerTotal: activeBindings.length,
      weekNew: activeBindings.filter((b) => b.consentAt >= weekAgo).length,
      activeIn7d: activeUserIds.size,
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
      where: { pharmacyId: auth.pharmacyId, unboundAt: null, user: { deactivatedAt: null } },
      include: { user: true },
      orderBy: { consentAt: 'desc' }
    });
    const alertIds = new Set((await alertsForPharmacy(app, auth.pharmacyId, 7)).map((a) => a.customer.userId));
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const latestByUser = await latestRecordsForUsers(app, bindings.map((binding) => binding.userId));
    const items = [];
    for (const binding of bindings) {
      if (query.search && !binding.user.nickname.includes(query.search)) continue;
      const rawLatest = latestByUser.get(binding.userId) ?? {};
      const latest = Object.fromEntries(METRICS.map((metric) => [
        metric,
        rawLatest[metric] ? serializeRecord(metric, rawLatest[metric], binding.user) : null
      ])) as Record<Metric, any>;
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
    const query = z.object({
      metric: metricSchema,
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100)
    }).parse(request.query);
    if (!(await assertActiveCustomer(app, auth.pharmacyId, userId))) return forbidden(reply);
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const records = await recordsForMetricPage(app, query.metric, userId, query.cursor, query.limit);
    const hasMore = records.length > query.limit;
    if (hasMore) records.pop();
    return {
      items: records.map((record: any) => serializeRecord(query.metric, record, user)),
      nextCursor: hasMore ? records.at(-1)?.id ?? null : null
    };
  });

  app.get('/customers/:userId/stats', async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    const userId = String((request.params as any).userId);
    const query = z.object({ metric: metricSchema, range: z.coerce.number().int().min(1).max(365).default(7) }).parse(request.query);
    if (!(await assertActiveCustomer(app, auth.pharmacyId, userId))) return forbidden(reply);
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return statsForMetric(app.prisma, userId, user, query.metric, query.range);
  });

  app.get('/alerts', async (request) => {
    const auth = request.auth as PharmacyToken;
    const query = z
      .object({
        days: z.coerce.number().int().min(1).max(90).default(7),
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
      update: { staffId: auth.staffId, ...(body.note === undefined ? {} : { note: body.note }) },
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
    return app.prisma.pharmacy.findUnique({
      where: { id: auth.pharmacyId },
      select: { id: true, name: true, address: true, phone: true, createdAt: true }
    });
  });

  app.patch('/profile', { preHandler: requireOwner }, async (request) => {
    const auth = request.auth as PharmacyToken;
    const body = z.object({
      name: z.string().trim().min(1).max(80).optional(),
      address: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(30).optional()
    }).parse(request.body);
    return app.prisma.pharmacy.update({
      where: { id: auth.pharmacyId },
      data: body,
      select: { id: true, name: true, address: true, phone: true, createdAt: true }
    });
  });

  app.get('/staff', { preHandler: requireOwner }, async (request) => {
    const auth = request.auth as PharmacyToken;
    return {
      items: await app.prisma.pharmacyStaff.findMany({
        where: { pharmacyId: auth.pharmacyId },
        select: publicStaffSelect,
        orderBy: { createdAt: 'asc' }
      })
    };
  });

  app.post('/staff', { preHandler: requireOwner }, async (request) => {
    const auth = request.auth as PharmacyToken;
    const body = z.object({
      username: z.string().trim().min(3).max(80),
      name: z.string().trim().min(1).max(40),
      password: strongPasswordSchema,
      role: z.enum(['owner', 'staff']).default('staff')
    }).parse(request.body);
    return app.prisma.pharmacyStaff.create({
      data: { pharmacyId: auth.pharmacyId, username: body.username, name: body.name, role: body.role, passwordHash: await hashPassword(body.password) },
      select: publicStaffSelect
    });
  });

  app.patch('/staff/:id', { preHandler: requireOwner }, async (request, reply) => {
    const auth = request.auth as PharmacyToken;
    const id = String((request.params as any).id);
    if (id === auth.staffId) return validationError(reply, '不可停用自己');
    const body = z.object({ disabledAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const staff = await app.prisma.pharmacyStaff.findFirst({ where: { id, pharmacyId: auth.pharmacyId }, select: { id: true } });
    if (!staff) return notFound(reply, '员工不存在');
    return app.prisma.pharmacyStaff.update({
      where: { id: staff.id },
      data: { disabledAt: body.disabledAt ? new Date(body.disabledAt) : null, authVersion: { increment: 1 } },
      select: publicStaffSelect
    });
  });
}

async function uniqueInviteCode(app: FastifyInstance) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join('');
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

async function recordsForMetricPage(app: FastifyInstance, metric: Metric, userId: string, cursor: string | undefined, limit: number) {
  return recordModel(app, metric).findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });
}

async function ownerOfRecord(app: FastifyInstance, metric: Metric, recordId: string) {
  const rows = await recordsForMetricRaw(app, metric, { id: recordId, deletedAt: null });
  return rows[0]?.userId ?? null;
}

async function recordsForMetricRaw(app: FastifyInstance, metric: Metric, where: any, select?: any) {
  return recordModel(app, metric).findMany(select ? { where, select } : { where });
}

async function alertsForPharmacy(app: FastifyInstance, pharmacyId: string, days: number) {
  const since = new Date(Date.now() - days * 86400000);
  const bindings = await app.prisma.pharmacyCustomer.findMany({
    where: { pharmacyId, unboundAt: null, user: { deactivatedAt: null } },
    include: { user: true }
  });
  if (bindings.length === 0) return [];
  const userIds = bindings.map((binding) => binding.userId);
  const users = new Map(bindings.map((binding) => [binding.userId, binding.user]));
  const recordsByMetric = await Promise.all(METRICS.map(async (metric) => ({
    metric,
    records: await recordsForMetricRaw(app, metric, { userId: { in: userIds }, deletedAt: null, measuredAt: { gte: since } })
  })));
  const items: any[] = [];
  for (const { metric, records } of recordsByMetric) {
    for (const record of records) {
      const user = users.get(record.userId);
      if (!user) continue;
      const serialized = serializeRecord(metric, record, user);
      if (serialized.status.key !== 'dhigh' && serialized.status.key !== 'dlow') continue;
      items.push({
        metric,
        record: serialized,
        customer: { userId: record.userId, nickname: user.nickname },
        followUp: null,
        occurredAt: record.measuredAt.toISOString()
      });
    }
  }
  const followUps = items.length > 0
    ? await app.prisma.followUp.findMany({
        where: {
          pharmacyId,
          OR: METRICS.map((metric) => ({
            metric,
            recordId: { in: items.filter((item) => item.metric === metric).map((item) => item.record.id) }
          }))
        }
      })
    : [];
  const followUpByRecord = new Map(followUps.map((item) => [`${item.metric}:${item.recordId}`, item]));
  for (const item of items) item.followUp = followUpByRecord.get(`${item.metric}:${item.record.id}`) ?? null;
  return items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

async function activeUsersSince(app: FastifyInstance, userIds: string[], since: Date): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await Promise.all(METRICS.map((metric) => recordsForMetricRaw(app, metric, {
    userId: { in: userIds },
    deletedAt: null,
    measuredAt: { gte: since }
  }, { userId: true })));
  return new Set(rows.flat().map((row) => row.userId));
}

async function latestRecordsForUsers(app: FastifyInstance, userIds: string[]) {
  const result = new Map<string, Partial<Record<Metric, any>>>();
  if (userIds.length === 0) return result;
  await Promise.all(METRICS.map(async (metric) => {
    const model = recordModel(app, metric);
    const maxima = await model.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, deletedAt: null },
      _max: { measuredAt: true }
    });
    const records = maxima.length > 0
      ? await model.findMany({
          where: { OR: maxima.map((row: any) => ({ userId: row.userId, measuredAt: row._max.measuredAt, deletedAt: null })) },
          orderBy: { createdAt: 'desc' }
        })
      : [];
    for (const record of records) {
      const current = result.get(record.userId) ?? {};
      if (!current[metric]) current[metric] = record;
      result.set(record.userId, current);
    }
  }));
  return result;
}

function recordModel(app: FastifyInstance, metric: Metric): any {
  if (metric === 'glucose') return app.prisma.glucoseRecord;
  if (metric === 'bp') return app.prisma.bpRecord;
  if (metric === 'lipid') return app.prisma.lipidRecord;
  return app.prisma.uricRecord;
}
