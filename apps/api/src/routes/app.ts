import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../env.js';
import { requireAuth, type AppToken } from '../plugins/auth.js';
import { conflict, notFound, validationError } from '../services/http.js';
import {
  METRICS,
  metricSafety,
  periodName,
  recomputeDailySummary,
  serializeRecord,
  statsForMetric,
  userStats,
  validateMetricInput
} from '../services/records.js';
import { hashPassword } from '../services/password.js';
import { inferBpPeriod, inferGlucosePeriod, localDayKey, type GlucosePeriod, type Metric } from '@tangji/shared';

const metricSchema = z.enum(['glucose', 'bp', 'lipid', 'uric']);

async function currentUser(app: FastifyInstance, auth: AppToken) {
  const user = await app.prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) throw new Error('missing user');
  return user;
}

export async function appRoutes(app: FastifyInstance) {
  app.post('/auth/wechat', async (request) => {
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    const openid = config.wechatMock ? `mock_${body.code}` : body.code;
    const user = await app.prisma.user.upsert({
      where: { openid },
      update: {},
      create: { openid, nickname: openid === 'mock_seed' ? '微信用户_8462' : '微信用户' }
    });
    const token = app.jwt.sign({ aud: 'app', userId: user.id });
    return { token, user };
  });

  app.get('/me', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request) => {
    const user = await currentUser(app, request.auth as AppToken);
    const stats = await userStats(app.prisma, user.id);
    const binding = await app.prisma.pharmacyCustomer.findFirst({
      where: { userId: user.id, unboundAt: null },
      include: { pharmacy: true }
    });
    return {
      id: user.id,
      nickname: user.nickname,
      sex: user.sex,
      unit: user.unit,
      target: {
        fastingLow: Number(user.fastingLow),
        fastingHigh: Number(user.fastingHigh),
        postMealHigh: Number(user.postMealHigh)
      },
      stats,
      binding: binding ? { pharmacyName: binding.pharmacy.name, boundAt: binding.consentAt.toISOString() } : null
    };
  });

  app.patch('/me', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const user = await currentUser(app, request.auth as AppToken);
    const schema = z.object({
      nickname: z.string().max(30).optional(),
      sex: z.enum(['male', 'female']).nullable().optional(),
      unit: z.enum(['mmol', 'mgdl']).optional(),
      target: z
        .object({ fastingLow: z.number(), fastingHigh: z.number(), postMealHigh: z.number() })
        .optional()
    });
    const body = schema.parse(request.body);
    if (body.target && !(body.target.fastingLow < body.target.fastingHigh && body.target.fastingHigh <= body.target.postMealHigh)) {
      return validationError(reply, '目标范围设置不正确');
    }
    const updated = await app.prisma.user.update({
      where: { id: user.id },
      data: {
        nickname: body.nickname,
        sex: body.sex,
        unit: body.unit,
        fastingLow: body.target?.fastingLow,
        fastingHigh: body.target?.fastingHigh,
        postMealHigh: body.target?.postMealHigh
      }
    });
    return updated;
  });

  app.get('/overview', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request) => {
    const user = await currentUser(app, request.auth as AppToken);
    const [glucose, bp, lipid, uric, stats] = await Promise.all([
      app.prisma.glucoseRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      app.prisma.bpRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      app.prisma.lipidRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      app.prisma.uricRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      userStats(app.prisma, user.id)
    ]);
    return {
      streak: stats.streak,
      todayCount: 0,
      glucose: { latest: glucose ? serializeRecord('glucose', glucose, user) : null },
      bp: { latest: bp ? serializeRecord('bp', bp, user) : null },
      lipid: { latest: lipid ? serializeRecord('lipid', lipid, user) : null },
      uric: { latest: uric ? serializeRecord('uric', uric, user) : null }
    };
  });

  app.get('/records/:metric', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const where = { userId: user.id, deletedAt: null };
    const records = await findRecords(app, metric, where);
    return { items: records.map((record) => serializeRecord(metric, record, user)), nextCursor: null };
  });

  app.post('/records/:metric', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const body = request.body as any;
    const result = validateMetricInput(metric, body, body?.unit ?? user.unit);
    if (!result.ok) return validationError(reply, result.message);
    const measuredAt = new Date(body.measuredAt ?? Date.now());
    const note = String(body.note ?? '').slice(0, 50);
    const created = await createRecord(app, metric, user.id, body, measuredAt, note, (result as any).valueMmol);
    if (metric === 'glucose') await recomputeDailySummary(app.prisma, user.id, localDayKey(measuredAt));
    const record = serializeRecord(metric, created, user);
    return reply.code(201).send({ record, safetyAlert: metricSafety(metric, { ...body, valueMmol: (result as any).valueMmol }) });
  });

  app.patch('/records/:metric/:id', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const existing = await findRecord(app, metric, (request.params as any).id, user.id);
    if (!existing) return notFound(reply);
    const body = request.body as any;
    const result = validateMetricInput(metric, body, body?.unit ?? user.unit);
    if (!result.ok) return validationError(reply, result.message);
    const measuredAt = new Date(body.measuredAt ?? existing.measuredAt);
    const updated = await updateRecord(app, metric, existing.id, body, measuredAt, String(body.note ?? existing.note), (result as any).valueMmol);
    if (metric === 'glucose') await recomputeDailySummary(app.prisma, user.id, localDayKey(measuredAt));
    return { record: serializeRecord(metric, updated, user), safetyAlert: metricSafety(metric, { ...body, valueMmol: (result as any).valueMmol }) };
  });

  app.delete('/records/:metric/:id', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const existing = await findRecord(app, metric, (request.params as any).id, user.id);
    if (!existing) return notFound(reply);
    await softDeleteRecord(app, metric, existing.id);
    return reply.code(204).send();
  });

  app.get('/records/recycle-bin', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request) => {
    const user = await currentUser(app, request.auth as AppToken);
    const items = [];
    for (const metric of METRICS) {
      const records = await findRecords(app, metric, { userId: user.id, deletedAt: { not: null } });
      items.push(...records.map((record) => ({ ...serializeRecord(metric, record, user), deletedAt: record.deletedAt, daysLeft: 7 })));
    }
    return { items };
  });

  app.post('/records/:metric/:id/restore', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const existing = await findRecord(app, metric, (request.params as any).id, user.id, true);
    if (!existing) return notFound(reply);
    const restored = await restoreRecord(app, metric, existing.id);
    return { record: serializeRecord(metric, restored, user) };
  });

  app.get('/stats', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request) => {
    const query = z.object({ metric: metricSchema, range: z.coerce.number().default(7) }).parse(request.query);
    const user = await currentUser(app, request.auth as AppToken);
    return statsForMetric(app.prisma, user.id, user, query.metric, query.range);
  });

  app.get('/pharmacy/invite/:code', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const code = String((request.params as any).code).toUpperCase();
    const invite = await app.prisma.inviteCode.findUnique({ where: { code }, include: { pharmacy: true } });
    if (!invite || invite.disabledAt || invite.expiresAt < new Date() || invite.pharmacy.disabledAt) return notFound(reply, '邀请码无效或已过期');
    const staff = await app.prisma.pharmacyStaff.findUnique({ where: { id: invite.staffId } });
    return { pharmacyName: invite.pharmacy.name, address: invite.pharmacy.address, staffName: staff?.name ?? '' };
  });

  app.post('/pharmacy/bind', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const user = await currentUser(app, request.auth as AppToken);
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    const active = await app.prisma.pharmacyCustomer.findFirst({ where: { userId: user.id, unboundAt: null } });
    if (active) return conflict(reply, 'BINDING_EXISTS');
    const invite = await app.prisma.inviteCode.findUnique({ where: { code: body.code.toUpperCase() }, include: { pharmacy: true } });
    if (!invite || invite.disabledAt || invite.expiresAt < new Date() || invite.pharmacy.disabledAt) return notFound(reply, '邀请码无效或已过期');
    const binding = await app.prisma.pharmacyCustomer.create({
      data: { userId: user.id, pharmacyId: invite.pharmacyId, inviteCodeId: invite.id }
    });
    return { binding };
  });

  app.delete('/pharmacy/bind', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const user = await currentUser(app, request.auth as AppToken);
    await app.prisma.pharmacyCustomer.updateMany({ where: { userId: user.id, unboundAt: null }, data: { unboundAt: new Date() } });
    return reply.code(204).send();
  });

  app.get('/export/csv', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (_request, reply) => {
    reply.header('content-type', 'text/csv;charset=utf-8');
    return '\ufeff日期,时间,血糖(mmol/L),血糖(mg/dL),时段,标签,备注\n';
  });
}

async function findRecords(app: FastifyInstance, metric: Metric, where: any): Promise<any[]> {
  const model = modelFor(app, metric);
  return model.findMany({ where, orderBy: { measuredAt: 'desc' } });
}

async function findRecord(app: FastifyInstance, metric: Metric, id: string, userId: string, includeDeleted = false) {
  const model = modelFor(app, metric);
  return model.findFirst({ where: { id, userId, ...(includeDeleted ? {} : { deletedAt: null }) } });
}

async function createRecord(app: FastifyInstance, metric: Metric, userId: string, body: any, measuredAt: Date, note: string, valueMmol?: number) {
  if (metric === 'glucose') {
    if (valueMmol == null) throw new Error('valueMmol is required for glucose');
    return app.prisma.glucoseRecord.create({
      data: {
        userId,
        valueMmol,
        period: body.period ?? inferGlucosePeriod(measuredAt),
        measuredAt,
        tags: JSON.stringify(body.tags ?? []),
        note
      }
    });
  }
  if (metric === 'bp') {
    return app.prisma.bpRecord.create({
      data: {
        userId,
        sbp: Number(body.sbp),
        dbp: Number(body.dbp),
        pulse: body.pulse == null ? null : Number(body.pulse),
        period: body.period ?? inferBpPeriod(measuredAt),
        measuredAt,
        tags: JSON.stringify(body.tags ?? []),
        note
      }
    });
  }
  if (metric === 'lipid') {
    return app.prisma.lipidRecord.create({
      data: {
        userId,
        tc: body.tc == null ? null : Number(body.tc),
        tg: body.tg == null ? null : Number(body.tg),
        ldl: body.ldl == null ? null : Number(body.ldl),
        hdl: body.hdl == null ? null : Number(body.hdl),
        fasting: body.fasting ?? true,
        measuredAt,
        note
      }
    });
  }
  return app.prisma.uricRecord.create({
    data: { userId, value: Number(body.value), fasting: body.fasting ?? true, measuredAt, note }
  });
}

async function updateRecord(app: FastifyInstance, metric: Metric, id: string, body: any, measuredAt: Date, note: string, valueMmol?: number) {
  if (metric === 'glucose') return app.prisma.glucoseRecord.update({ where: { id }, data: { valueMmol, period: body.period, measuredAt, tags: JSON.stringify(body.tags ?? []), note } });
  if (metric === 'bp') return app.prisma.bpRecord.update({ where: { id }, data: { sbp: Number(body.sbp), dbp: Number(body.dbp), pulse: body.pulse == null ? null : Number(body.pulse), period: body.period, measuredAt, tags: JSON.stringify(body.tags ?? []), note } });
  if (metric === 'lipid') return app.prisma.lipidRecord.update({ where: { id }, data: { tc: body.tc == null ? null : Number(body.tc), tg: body.tg == null ? null : Number(body.tg), ldl: body.ldl == null ? null : Number(body.ldl), hdl: body.hdl == null ? null : Number(body.hdl), fasting: body.fasting ?? true, measuredAt, note } });
  return app.prisma.uricRecord.update({ where: { id }, data: { value: Number(body.value), fasting: body.fasting ?? true, measuredAt, note } });
}

async function softDeleteRecord(app: FastifyInstance, metric: Metric, id: string) {
  return modelFor(app, metric).update({ where: { id }, data: { deletedAt: new Date() } });
}

async function restoreRecord(app: FastifyInstance, metric: Metric, id: string) {
  return modelFor(app, metric).update({ where: { id }, data: { deletedAt: null } });
}

function modelFor(app: FastifyInstance, metric: Metric): any {
  if (metric === 'glucose') return app.prisma.glucoseRecord;
  if (metric === 'bp') return app.prisma.bpRecord;
  if (metric === 'lipid') return app.prisma.lipidRecord;
  return app.prisma.uricRecord;
}
