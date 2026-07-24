import type { FastifyInstance } from 'fastify';
import archiver from 'archiver';
import { Prisma } from '@prisma/client';
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
import {
  resolveWechatOpenid,
  resolveWechatWebOpenid,
  WechatLoginError,
  type ResolvedWechatIdentity
} from '../services/wechat.js';
import { recycleCutoff, recycleDaysLeft } from '../services/recycle.js';
import { hashPassword, isStrongPassword, verifyPassword } from '../services/password.js';
import { inferBpPeriod, inferGlucosePeriod, localDayKey, type GlucosePeriod, type Metric } from '@tangji/shared';

const metricSchema = z.enum(['glucose', 'bp', 'lipid', 'uric']);
const loginNameSchema = z.string().trim().min(4).max(32).regex(/^[A-Za-z0-9_.-]+$/).transform((value) => value.toLowerCase());
const strongPasswordSchema = z.string().min(12).max(128).refine(isStrongPassword, {
  message: '密码至少 12 位，且需包含大小写字母、数字和符号'
});
const invalidPasswordHash = '$2a$10$uTWjV9reQFAsAXui6E4MP.QvGzyLyN4HqFt8W7S2BYCaZH9XbGEMe';
const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

async function currentUser(app: FastifyInstance, auth: AppToken) {
  const user = await app.prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) throw new Error('missing user');
  return user;
}

function publicAppUser(user: {
  id: string;
  loginName: string | null;
  nickname: string;
  sex: string | null;
  unit: string;
  passwordHash: string | null;
}) {
  return {
    id: user.id,
    loginName: user.loginName,
    nickname: user.nickname,
    sex: user.sex,
    unit: user.unit,
    hasPassword: Boolean(user.passwordHash)
  };
}

function createAppToken(app: FastifyInstance, user: { id: string; authVersion: number }) {
  return app.jwt.sign({ aud: 'app', userId: user.id, ver: user.authVersion });
}

type WechatProvider = 'mini' | 'web';

async function findWechatUser(app: FastifyInstance, provider: WechatProvider, identity: ResolvedWechatIdentity) {
  const providerUser = provider === 'mini'
    ? await app.prisma.user.findFirst({ where: { OR: [{ miniOpenid: identity.openid }, { openid: identity.openid }] } })
    : await app.prisma.user.findFirst({ where: { OR: [{ webOpenid: identity.openid }, { openid: `web:${identity.openid}` }] } });
  const unionUser = identity.unionid
    ? await app.prisma.user.findUnique({ where: { unionid: identity.unionid } })
    : null;
  if (providerUser && unionUser && providerUser.id !== unionUser.id) {
    throw new WechatLoginError('微信身份关联冲突', { kind: 'identity-conflict' });
  }
  return unionUser ?? providerUser;
}

async function createAppSession(app: FastifyInstance, provider: WechatProvider, identity: ResolvedWechatIdentity) {
  let user = await findWechatUser(app, provider, identity);
  const identityData = {
    ...(provider === 'mini' ? { miniOpenid: identity.openid } : { webOpenid: identity.openid }),
    ...(identity.unionid ? { unionid: identity.unionid } : {})
  };
  try {
    user = user
      ? await app.prisma.user.update({ where: { id: user.id }, data: identityData })
      : await app.prisma.user.create({
          data: {
            openid: provider === 'mini' ? identity.openid : `web:${identity.openid}`,
            ...identityData,
            nickname: identity.openid === 'mock_seed_demo' ? '微信用户_8462' : '微信用户'
          }
        });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    user = await findWechatUser(app, provider, identity);
    if (!user) throw error;
    user = await app.prisma.user.update({ where: { id: user.id }, data: identityData });
  }
  if (user.deactivatedAt) {
    throw new WechatLoginError('账号已注销', { kind: 'deactivated' });
  }
  return { token: createAppToken(app, user), user: publicAppUser(user) };
}

export async function appRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const body = z.object({
      loginName: loginNameSchema,
      nickname: z.string().trim().min(1).max(30),
      password: strongPasswordSchema
    }).parse(request.body);
    try {
      const user = await app.prisma.user.create({
        data: {
          openid: `local:${body.loginName}`,
          loginName: body.loginName,
          passwordHash: await hashPassword(body.password),
          nickname: body.nickname
        }
      });
      return reply.code(201).send({ token: createAppToken(app, user), user: publicAppUser(user) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return conflict(reply, 'ACCOUNT_EXISTS', '该账号已被注册');
      }
      throw error;
    }
  });

  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ loginName: loginNameSchema, password: z.string().min(1).max(128) }).parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { loginName: body.loginName } });
    const passwordMatches = await verifyPassword(body.password, user?.passwordHash ?? invalidPasswordHash);
    if (!user || !user.passwordHash || user.deactivatedAt || !passwordMatches) {
      return reply.code(403).send({ error: { code: 'INVALID_CREDENTIALS', message: '账号或密码不正确' } });
    }
    return { token: createAppToken(app, user), user: publicAppUser(user) };
  });

  app.post('/auth/change-password', {
    preHandler: (request, reply) => requireAuth(request, reply, 'app'),
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    const auth = request.auth as AppToken;
    const body = z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: strongPasswordSchema
    }).parse(request.body);
    const user = await currentUser(app, auth);
    if (!user.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      return reply.code(403).send({ error: { code: 'INVALID_CREDENTIALS', message: '当前密码不正确' } });
    }
    if (await verifyPassword(body.newPassword, user.passwordHash)) {
      return validationError(reply, '新密码不能与当前密码相同');
    }
    await app.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword), authVersion: { increment: 1 } }
    });
    return reply.code(204).send();
  });

  app.post('/auth/wechat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!config.wechatMock && (!config.wechatAppId || !config.wechatSecret)) {
      return reply.code(503).send({ error: { code: 'WECHAT_MINI_DISABLED', message: '小程序微信登录尚未启用' } });
    }
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    try {
      const identity = await resolveWechatOpenid(body.code);
      return await createAppSession(app, 'mini', identity);
    } catch (error) {
      if (error instanceof WechatLoginError) {
        request.log.warn({ detail: error.causeDetail }, error.message);
        if (error.causeDetail?.kind === 'deactivated') {
          return reply.code(403).send({ error: { code: 'ACCOUNT_DEACTIVATED', message: '账号已注销' } });
        }
        return reply.code(502).send({ error: { code: 'WECHAT_AUTH_FAILED', message: '微信登录失败，请稍后重试' } });
      }
      throw error;
    }
  });

  app.get('/auth/wechat-web/config', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () => {
    return {
      enabled: Boolean(config.wechatWebAppId && config.wechatWebSecret),
      appId: config.wechatWebAppId,
      redirectUri: config.wechatWebRedirectUri
    };
  });

  app.post('/auth/wechat-web', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!config.wechatMock && (!config.wechatWebAppId || !config.wechatWebSecret)) {
      return reply.code(503).send({ error: { code: 'WECHAT_WEB_DISABLED', message: '微信网页授权尚未启用' } });
    }
    const body = z.object({ code: z.string().min(1).max(512) }).parse(request.body);
    try {
      const identity = await resolveWechatWebOpenid(body.code);
      return await createAppSession(app, 'web', identity);
    } catch (error) {
      if (error instanceof WechatLoginError) {
        request.log.warn({ detail: error.causeDetail }, error.message);
        if (error.causeDetail?.kind === 'deactivated') {
          return reply.code(403).send({ error: { code: 'ACCOUNT_DEACTIVATED', message: '账号已注销' } });
        }
        return reply.code(502).send({ error: { code: 'WECHAT_AUTH_FAILED', message: '微信登录失败，请稍后重试' } });
      }
      throw error;
    }
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
      loginName: user.loginName,
      hasPassword: Boolean(user.passwordHash),
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
    return {
      id: updated.id,
      nickname: updated.nickname,
      sex: updated.sex,
      unit: updated.unit,
      target: {
        fastingLow: Number(updated.fastingLow),
        fastingHigh: Number(updated.fastingHigh),
        postMealHigh: Number(updated.postMealHigh)
      }
    };
  });

  app.delete('/me', {
    preHandler: (req, reply) => requireAuth(req, reply, 'app'),
    config: { rateLimit: { max: 2, timeWindow: '1 hour' } }
  }, async (request, reply) => {
    const user = await currentUser(app, request.auth as AppToken);
    await app.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM "FollowUp"
        WHERE ("metric" = 'glucose' AND "recordId" IN (SELECT "id" FROM "GlucoseRecord" WHERE "userId" = ${user.id}))
           OR ("metric" = 'bp' AND "recordId" IN (SELECT "id" FROM "BpRecord" WHERE "userId" = ${user.id}))
           OR ("metric" = 'lipid' AND "recordId" IN (SELECT "id" FROM "LipidRecord" WHERE "userId" = ${user.id}))
           OR ("metric" = 'uric' AND "recordId" IN (SELECT "id" FROM "UricRecord" WHERE "userId" = ${user.id}))
      `;
      await tx.pharmacyAccessLog.deleteMany({ where: { userId: user.id } });
      await tx.pharmacyCustomer.deleteMany({ where: { userId: user.id } });
      await tx.dailySummary.deleteMany({ where: { userId: user.id } });
      await tx.glucoseRecord.deleteMany({ where: { userId: user.id } });
      await tx.bpRecord.deleteMany({ where: { userId: user.id } });
      await tx.lipidRecord.deleteMany({ where: { userId: user.id } });
      await tx.uricRecord.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { deactivatedAt: new Date(), nickname: '已注销用户', sex: null }
      });
    }, { timeout: 30_000 });
    return reply.code(204).send();
  });

  app.get('/overview', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request) => {
    const user = await currentUser(app, request.auth as AppToken);
    const [glucose, bp, lipid, uric, stats, todayCount] = await Promise.all([
      app.prisma.glucoseRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      app.prisma.bpRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      app.prisma.lipidRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      app.prisma.uricRecord.findFirst({ where: { userId: user.id, deletedAt: null }, orderBy: { measuredAt: 'desc' } }),
      userStats(app.prisma, user.id),
      countTodayRecords(app, user.id)
    ]);
    return {
      streak: stats.streak,
      todayCount,
      glucose: { latest: glucose ? serializeRecord('glucose', glucose, user) : null },
      bp: { latest: bp ? serializeRecord('bp', bp, user) : null },
      lipid: { latest: lipid ? serializeRecord('lipid', lipid, user) : null },
      uric: { latest: uric ? serializeRecord('uric', uric, user) : null }
    };
  });

  app.get('/records/:metric', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const query = pageQuerySchema.parse(request.query);
    const user = await currentUser(app, request.auth as AppToken);
    const where = { userId: user.id, deletedAt: null };
    const records = await findRecordsPage(app, metric, where, query.cursor, query.limit);
    const hasMore = records.length > query.limit;
    if (hasMore) records.pop();
    return {
      items: records.map((record) => serializeRecord(metric, record, user)),
      nextCursor: hasMore ? records.at(-1)?.id ?? null : null
    };
  });

  app.post('/records/:metric', {
    preHandler: (req, reply) => requireAuth(req, reply, 'app'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const body = request.body as any;
    const result = validateMetricInput(metric, body, body?.unit ?? user.unit);
    if (!result.ok) return validationError(reply, result.message);
    const measuredAt = new Date(body.measuredAt ?? Date.now());
    if (Number.isNaN(measuredAt.getTime())) return validationError(reply, '测量时间不正确');
    const note = String(body.note ?? '').slice(0, 50);
    const created = await createRecord(app, metric, user.id, body, measuredAt, note, (result as any).valueMmol);
    if (metric === 'glucose') await recomputeDailySummary(app.prisma, user.id, localDayKey(measuredAt));
    const record = serializeRecord(metric, created, user);
    return reply.code(201).send({ record, safetyAlert: metricSafety(metric, { ...body, valueMmol: (result as any).valueMmol }) });
  });

  app.patch('/records/:metric/:id', {
    preHandler: (req, reply) => requireAuth(req, reply, 'app'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const existing = await findRecord(app, metric, (request.params as any).id, user.id);
    if (!existing) return notFound(reply);
    const body = request.body as any;
    const result = validateMetricInput(metric, body, body?.unit ?? user.unit);
    if (!result.ok) return validationError(reply, result.message);
    const measuredAt = new Date(body.measuredAt ?? existing.measuredAt);
    if (Number.isNaN(measuredAt.getTime())) return validationError(reply, '测量时间不正确');
    const updated = await updateRecord(app, metric, existing.id, body, measuredAt, String(body.note ?? existing.note).slice(0, 50), (result as any).valueMmol);
    if (metric === 'glucose') {
      const oldDay = localDayKey(existing.measuredAt);
      const newDay = localDayKey(measuredAt);
      await recomputeDailySummary(app.prisma, user.id, oldDay);
      if (newDay !== oldDay) await recomputeDailySummary(app.prisma, user.id, newDay);
    }
    return { record: serializeRecord(metric, updated, user), safetyAlert: metricSafety(metric, { ...body, valueMmol: (result as any).valueMmol }) };
  });

  app.delete('/records/:metric/:id', {
    preHandler: (req, reply) => requireAuth(req, reply, 'app'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const existing = await findRecord(app, metric, (request.params as any).id, user.id);
    if (!existing) return notFound(reply);
    await softDeleteRecord(app, metric, existing.id);
    if (metric === 'glucose') await recomputeDailySummary(app.prisma, user.id, localDayKey(existing.measuredAt));
    return reply.code(204).send();
  });

  app.get('/records/recycle-bin', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request) => {
    const user = await currentUser(app, request.auth as AppToken);
    const now = new Date();
    const cutoff = recycleCutoff(now);
    const items = [];
    for (const metric of METRICS) {
      const records = await findRecords(app, metric, { userId: user.id, deletedAt: { gte: cutoff } });
      items.push(...records.map((record) => ({
        ...serializeRecord(metric, record, user),
        deletedAt: record.deletedAt,
        daysLeft: recycleDaysLeft(record.deletedAt, now)
      })));
    }
    return { items: items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime()) };
  });

  app.post('/records/:metric/:id/restore', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const metric = metricSchema.parse((request.params as any).metric);
    const user = await currentUser(app, request.auth as AppToken);
    const existing = await findRecord(app, metric, (request.params as any).id, user.id, true);
    if (!existing || !existing.deletedAt || existing.deletedAt < recycleCutoff()) return notFound(reply);
    const restored = await restoreRecord(app, metric, existing.id);
    if (metric === 'glucose') await recomputeDailySummary(app.prisma, user.id, localDayKey(existing.measuredAt));
    return { record: serializeRecord(metric, restored, user) };
  });

  app.get('/stats', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request) => {
    const query = z.object({ metric: metricSchema, range: z.coerce.number().int().min(1).max(365).default(7) }).parse(request.query);
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

  app.post('/pharmacy/bind', {
    preHandler: (req, reply) => requireAuth(req, reply, 'app'),
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    const user = await currentUser(app, request.auth as AppToken);
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    const active = await app.prisma.pharmacyCustomer.findFirst({ where: { userId: user.id, unboundAt: null } });
    if (active) return conflict(reply, 'BINDING_EXISTS');
    const invite = await app.prisma.inviteCode.findUnique({ where: { code: body.code.toUpperCase() }, include: { pharmacy: true } });
    if (!invite || invite.disabledAt || invite.expiresAt < new Date() || invite.pharmacy.disabledAt) return notFound(reply, '邀请码无效或已过期');
    try {
      const binding = await app.prisma.pharmacyCustomer.create({
        data: { userId: user.id, pharmacyId: invite.pharmacyId, inviteCodeId: invite.id }
      });
      return { binding };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return conflict(reply, 'BINDING_EXISTS');
      }
      throw error;
    }
  });

  app.delete('/pharmacy/bind', { preHandler: (req, reply) => requireAuth(req, reply, 'app') }, async (request, reply) => {
    const user = await currentUser(app, request.auth as AppToken);
    await app.prisma.pharmacyCustomer.updateMany({ where: { userId: user.id, unboundAt: null }, data: { unboundAt: new Date() } });
    return reply.code(204).send();
  });

  app.get('/report/weekly', {
    preHandler: (req, reply) => requireAuth(req, reply, 'app'),
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } }
  }, async (request) => {
    const user = await currentUser(app, request.auth as AppToken);
    return weeklyReport(app, user);
  });

  app.get('/export/csv', {
    preHandler: (req, reply) => requireAuth(req, reply, 'app'),
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    const query = z.object({ metric: z.union([metricSchema, z.literal('all')]).default('glucose') }).parse(request.query);
    const user = await currentUser(app, request.auth as AppToken);
    const stamp = dateStamp(new Date());
    const exportMetrics = query.metric === 'all' ? METRICS : [query.metric];
    const exportCount = (await Promise.all(exportMetrics.map((metric) => countRecords(app, metric, user.id))))
      .reduce((sum, count) => sum + count, 0);
    if (exportCount > config.exportMaxRecords) {
      return reply.code(413).send({
        error: {
          code: 'EXPORT_TOO_LARGE',
          message: `导出记录超过 ${config.exportMaxRecords} 条，请缩小数据范围`
        }
      });
    }
    if (query.metric === 'all') {
      const archive = archiver('zip', { zlib: { level: 9 } });
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', contentDisposition(`糖迹-健康记录-${stamp}.zip`));
      for (const metric of METRICS) {
        archive.append(await csvForMetric(app, metric, user), { name: `糖迹-${metricLabel(metric)}记录-${stamp}.csv` });
      }
      void archive.finalize();
      return reply.send(archive);
    }
    reply.header('content-type', 'text/csv;charset=utf-8');
    reply.header('content-disposition', contentDisposition(`糖迹-${metricLabel(query.metric)}记录-${stamp}.csv`));
    return csvForMetric(app, query.metric, user);
  });
}

async function weeklyReport(app: FastifyInstance, user: any) {
  const rangeDays = 7;
  const fromDate = new Date(Date.now() - (rangeDays - 1) * 86400000);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date();
  const [glucose, bp, lipid, uric] = await Promise.all([
    statsForMetric(app.prisma, user.id, user, 'glucose', rangeDays),
    statsForMetric(app.prisma, user.id, user, 'bp', rangeDays),
    weeklyLipidSection(app, user, fromDate),
    statsForMetric(app.prisma, user.id, user, 'uric', rangeDays)
  ]);
  const sections: Record<string, unknown> = {};
  if (glucose.n > 0) sections.glucose = glucose;
  if (bp.n > 0) sections.bp = bp;
  if (lipid.n > 0) sections.lipid = lipid;
  if (uric.n > 0) sections.uric = uric;
  return {
    title: '近 7 天健康报告',
    rangeDays,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    sections,
    footnote: '各指标参考口径仅供健康记录与沟通参考，不构成诊疗依据。'
  };
}

async function countTodayRecords(app: FastifyInstance, userId: string) {
  const key = localDayKey(new Date());
  const start = new Date(`${key}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 86400000);
  const where = { userId, deletedAt: null, measuredAt: { gte: start, lt: end } };
  const counts = await Promise.all([
    app.prisma.glucoseRecord.count({ where }),
    app.prisma.bpRecord.count({ where }),
    app.prisma.lipidRecord.count({ where }),
    app.prisma.uricRecord.count({ where })
  ]);
  return counts.reduce((sum, value) => sum + value, 0);
}

async function weeklyLipidSection(app: FastifyInstance, user: any, fromDate: Date) {
  const records = await app.prisma.lipidRecord.findMany({
    where: { userId: user.id, deletedAt: null, measuredAt: { gte: fromDate } },
    orderBy: { measuredAt: 'asc' }
  });
  const items = records.map((record) => serializeRecord('lipid', record, user));
  return { n: items.length, latest: items.at(-1) ?? null, series: items };
}

async function csvForMetric(app: FastifyInstance, metric: Metric, user: any) {
  const rows = await csvRowsForMetric(app, metric, user);
  return `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

async function csvRowsForMetric(app: FastifyInstance, metric: Metric, user: any) {
  const records = await findRecordsAsc(app, metric, { userId: user.id, deletedAt: null });
  if (metric === 'glucose') {
    return [
      ['日期', '时间', '血糖(mmol/L)', '血糖(mg/dL)', '时段', '标签', '备注'],
      ...records.map((record) => {
        const item = serializeRecord(metric, record, user);
        const [date, time] = localDateTime(item.measuredAt);
        return [date, time, item.valueMmol.toFixed(1), Math.round(item.valueMmol * 18), item.periodName, item.tags.join('、'), sanitizeNote(item.note)];
      })
    ];
  }
  if (metric === 'bp') {
    return [
      ['日期', '时间', '收缩压(mmHg)', '舒张压(mmHg)', '脉搏', '时段', '状态', '备注'],
      ...records.map((record) => {
        const item = serializeRecord(metric, record, user);
        const [date, time] = localDateTime(item.measuredAt);
        return [date, time, item.sbp, item.dbp, item.pulse ?? '', item.periodName, item.status.label, sanitizeNote(item.note)];
      })
    ];
  }
  if (metric === 'lipid') {
    return [
      ['日期', '时间', '总胆固醇(mmol/L)', '甘油三酯(mmol/L)', '低密度脂蛋白(mmol/L)', '高密度脂蛋白(mmol/L)', '是否空腹', '备注'],
      ...records.map((record) => {
        const item = serializeRecord(metric, record, user);
        const [date, time] = localDateTime(item.measuredAt);
        return [date, time, item.tc ?? '', item.tg ?? '', item.ldl ?? '', item.hdl ?? '', item.fasting ? '是' : '否', sanitizeNote(item.note)];
      })
    ];
  }
  return [
    ['日期', '时间', '尿酸(μmol/L)', '是否空腹', '备注'],
    ...records.map((record) => {
      const item = serializeRecord(metric, record, user);
      const [date, time] = localDateTime(item.measuredAt);
      return [date, time, item.value, item.fasting ? '是' : '否', sanitizeNote(item.note)];
    })
  ];
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sanitizeNote(value: string) {
  return String(value ?? '').replaceAll(',', '，');
}

function localDateTime(value: string | Date): [string, string] {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return [`${part('year')}-${part('month')}-${part('day')}`, `${part('hour')}:${part('minute')}`];
}

function dateStamp(value: Date) {
  const [date] = localDateTime(value);
  return date.replaceAll('-', '');
}

function contentDisposition(filename: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function metricLabel(metric: Metric) {
  return ({ glucose: '血糖', bp: '血压', lipid: '血脂', uric: '尿酸' } as const)[metric];
}

async function findRecords(app: FastifyInstance, metric: Metric, where: any): Promise<any[]> {
  const model = modelFor(app, metric);
  return model.findMany({ where, orderBy: { measuredAt: 'desc' } });
}

async function findRecordsPage(app: FastifyInstance, metric: Metric, where: any, cursor: string | undefined, limit: number): Promise<any[]> {
  const model = modelFor(app, metric);
  return model.findMany({
    where,
    orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });
}

async function findRecordsAsc(app: FastifyInstance, metric: Metric, where: any): Promise<any[]> {
  const model = modelFor(app, metric);
  return model.findMany({ where, orderBy: { measuredAt: 'asc' } });
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

async function countRecords(app: FastifyInstance, metric: Metric, userId: string): Promise<number> {
  return modelFor(app, metric).count({ where: { userId, deletedAt: null } });
}
