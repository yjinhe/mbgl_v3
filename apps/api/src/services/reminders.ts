import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { BP_REMINDER_NOTE, GLUCOSE_PERIOD_MAP, REMINDER_TIPS, localDayKey, type GlucosePeriod } from '@tangji/shared';
import type { MiniprogramState, ReminderTemplate } from '../env.js';
import { getWechatAccessToken, resetWechatTokenCache, WechatTokenError } from './wechat-token.js';

export type ReminderMetric = 'glucose' | 'bp';

export const REMINDER_METRICS: readonly ReminderMetric[] = ['glucose', 'bp'];
export const REMINDER_QUOTA_MAX = 30;
// Tolerates a delayed cron run: a plan fires while now - 10min < time <= now (HH:mm string comparison).
export const REMINDER_WINDOW_MINUTES = 10;
export const REMINDER_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_REMINDER_TIME: Record<ReminderMetric, string> = { glucose: '07:00', bp: '07:30' };
export const DEFAULT_GLUCOSE_REMINDER_PERIOD: GlucosePeriod = 'fasting';

const SUBSCRIBE_SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';
const ERRCODE_QUOTA_EXHAUSTED = 43101; // user rejected or no remaining one-time subscription
const ERRCODE_INVALID_OPENID = 40003;
const ERRCODE_FIELD_FORMAT = 47003;
const ERRCODE_BAD_TOKEN = new Set([40001, 40014, 42001]); // invalid or expired access_token: refresh and retry next tick

export function isReminderMetric(value: unknown): value is ReminderMetric {
  return value === 'glucose' || value === 'bp';
}

export function isGlucosePeriod(value: unknown): value is GlucosePeriod {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GLUCOSE_PERIOD_MAP, value);
}

export interface ReminderPlanRow {
  metric: string;
  enabled: boolean;
  time: string;
  period: string | null;
  quota: number;
}

export function serializePlan(plan: ReminderPlanRow) {
  return { metric: plan.metric, enabled: plan.enabled, time: plan.time, period: plan.period, quota: plan.quota };
}

/**
 * The openid used as `touser` for subscribe messages.
 * Mini-program logins store the openid in `miniOpenid`. Accounts created by the mini program before that column existed
 * only carry the raw openid in `openid`, so it is used as a fallback. Web logins store `openid` as `web:<openid>` and
 * local accounts as `local:<loginName>`; neither ever had a mini-program session, so they cannot receive messages.
 */
export function miniOpenidOf(user: { openid: string; miniOpenid: string | null }): string | null {
  if (user.miniOpenid) return user.miniOpenid;
  if (!user.openid || user.openid.startsWith('web:') || user.openid.startsWith('local:')) return null;
  return user.openid;
}

export async function listPlans(prisma: PrismaClient, userId: string) {
  const plans = await prisma.reminderPlan.findMany({ where: { userId } });
  const order = (metric: string) => REMINDER_METRICS.indexOf(metric as ReminderMetric);
  return plans.sort((a, b) => order(a.metric) - order(b.metric));
}

export interface UpsertPlanInput {
  enabled: boolean;
  /** 'HH:mm'; keeps the stored time (or the metric default) when omitted, so `{ enabled: false }` alone is accepted. */
  time?: string;
  /** Glucose only; keeps the stored period (default fasting) when omitted. Ignored for bp. */
  period?: string;
}

export async function upsertPlan(prisma: PrismaClient, userId: string, metric: ReminderMetric, input: UpsertPlanInput) {
  const existing = await prisma.reminderPlan.findUnique({ where: { userId_metric: { userId, metric } } });
  const time = input.time ?? existing?.time ?? DEFAULT_REMINDER_TIME[metric];
  const period = metric === 'glucose' ? input.period ?? existing?.period ?? DEFAULT_GLUCOSE_REMINDER_PERIOD : null;
  return prisma.reminderPlan.upsert({
    where: { userId_metric: { userId, metric } },
    create: { userId, metric, enabled: input.enabled, time, period },
    update: { enabled: input.enabled, time, period }
  });
}

/** Adds one send to each accepted metric (capped at REMINDER_QUOTA_MAX), creating a disabled plan row when none exists. */
export async function addSubscriptionQuota(prisma: PrismaClient, userId: string, metrics: readonly ReminderMetric[]) {
  for (const metric of new Set(metrics)) {
    await prisma.$transaction([
      prisma.reminderPlan.upsert({
        where: { userId_metric: { userId, metric } },
        create: {
          userId,
          metric,
          enabled: false,
          time: DEFAULT_REMINDER_TIME[metric],
          period: metric === 'glucose' ? DEFAULT_GLUCOSE_REMINDER_PERIOD : null,
          quota: 1
        },
        update: { quota: { increment: 1 } }
      }),
      prisma.reminderPlan.updateMany({
        where: { userId, metric, quota: { gt: REMINDER_QUOTA_MAX } },
        data: { quota: REMINDER_QUOTA_MAX }
      })
    ]);
  }
  return listPlans(prisma, userId);
}

export async function deleteUserReminders(prisma: Pick<Prisma.TransactionClient, 'reminderPlan' | 'reminderLog'>, userId: string) {
  await prisma.reminderPlan.deleteMany({ where: { userId } });
  await prisma.reminderLog.deleteMany({ where: { userId } });
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** Current Asia/Shanghai day key and wall clock, plus the HH:mm filter for plans due in this tick. */
export function reminderWindow(now: Date) {
  const today = localDayKey(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const hour = part('hour') % 24;
  const minute = part('minute');
  const minutes = hour * 60 + minute;
  const time = `${pad(hour)}:${pad(minute)}`;
  // Never wrap past midnight: a plan at 23:5x that missed its own tick is not resent under the next day's key.
  const windowStart = minutes - REMINDER_WINDOW_MINUTES;
  const after = windowStart >= 0 ? `${pad(Math.floor(windowStart / 60))}:${pad(windowStart % 60)}` : null;
  return { today, time, after };
}

export function shanghaiDayRange(dayKey: string) {
  const start = new Date(`${dayKey}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

async function hasRecordOnDay(prisma: PrismaClient, userId: string, metric: ReminderMetric, dayKey: string) {
  const { start, end } = shanghaiDayRange(dayKey);
  const where = { userId, deletedAt: null, measuredAt: { gte: start, lt: end } };
  const count = metric === 'glucose'
    ? await prisma.glucoseRecord.count({ where })
    : await prisma.bpRecord.count({ where });
  return count > 0;
}

export interface SubscribeMessage {
  touser: string;
  template_id: string;
  page: string;
  miniprogram_state: MiniprogramState;
  lang: 'zh_CN';
  data: Record<string, { value: string }>;
}

/** Builds the subscribe/send payload; values are mapped onto the configured field keys in message order. */
export function buildReminderMessage(
  plan: { metric: ReminderMetric; time: string; period: string | null },
  template: ReminderTemplate,
  touser: string,
  dayKey: string,
  miniprogramState: MiniprogramState
): SubscribeMessage {
  const time = `${dayKey} ${plan.time}`;
  let page: string;
  let values: string[];
  if (plan.metric === 'glucose') {
    const period = isGlucosePeriod(plan.period) ? plan.period : DEFAULT_GLUCOSE_REMINDER_PERIOD;
    page = `pages/record/index?metric=glucose&period=${period}&from=reminder`;
    values = [time, GLUCOSE_PERIOD_MAP[period].name, REMINDER_TIPS[period]];
  } else {
    page = 'pages/record/index?metric=bp&from=reminder';
    values = [time, BP_REMINDER_NOTE];
  }
  const data: Record<string, { value: string }> = {};
  template.fields.forEach((field, index) => {
    const value = values[index];
    if (value !== undefined) data[field] = { value };
  });
  return { touser, template_id: template.id, page, miniprogram_state: miniprogramState, lang: 'zh_CN', data };
}

const sendResponseSchema = z.object({ errcode: z.number().optional(), errmsg: z.string().optional() });

interface SendOutcome {
  ok: boolean;
  errcode: number | null;
  errmsg: string | null;
  /** Transport-level failure (network, HTTP, unparsable body): nothing reached WeChat, safe to retry next tick. */
  transport: boolean;
}

async function sendSubscribeMessage(fetchImpl: typeof fetch, accessToken: string, message: SubscribeMessage): Promise<SendOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${SUBSCRIBE_SEND_URL}?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    return { ok: false, errcode: null, errmsg: 'network error', transport: true };
  }
  if (!response.ok) {
    return { ok: false, errcode: null, errmsg: `HTTP ${response.status}`, transport: true };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, errcode: null, errmsg: 'invalid response body', transport: true };
  }
  const parsed = sendResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errcode: null, errmsg: 'invalid response body', transport: true };
  }
  const errcode = parsed.data.errcode ?? 0;
  return { ok: errcode === 0, errcode: errcode === 0 ? null : errcode, errmsg: parsed.data.errmsg ?? null, transport: false };
}

export interface ReminderConfig {
  wechatAppId: string;
  wechatSecret: string;
  miniprogramState: MiniprogramState;
  reminderTemplates: { glucose?: ReminderTemplate; bp?: ReminderTemplate };
}

export interface ReminderLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ReminderTickDeps {
  now: Date;
  fetch: typeof fetch;
  config: ReminderConfig;
  log: ReminderLogger;
}

export interface ReminderTickResult {
  today: string;
  time: string;
  due: number;
  sent: number;
  skipped: number;
  failed: number;
}

export function remindersConfigured(config: ReminderConfig) {
  return Boolean(config.wechatAppId && config.wechatSecret && (config.reminderTemplates.glucose || config.reminderTemplates.bp));
}

/**
 * One cron tick (spec §6): finds enabled plans with quota that are due in the last 10 minutes and were not handled today,
 * skips those whose metric was already recorded today, otherwise sends one subscribe message and updates the plan.
 */
export async function runReminderTick(prisma: PrismaClient, deps: ReminderTickDeps): Promise<ReminderTickResult> {
  const { now, config, log } = deps;
  const { today, time, after } = reminderWindow(now);
  const result: ReminderTickResult = { today, time, due: 0, sent: 0, skipped: 0, failed: 0 };

  const plans = await prisma.reminderPlan.findMany({
    where: {
      enabled: true,
      quota: { gt: 0 },
      time: after ? { lte: time, gt: after } : { lte: time },
      OR: [{ lastSentDay: null }, { lastSentDay: { not: today } }],
      user: { deactivatedAt: null }
    },
    include: { user: { select: { id: true, openid: true, miniOpenid: true } } },
    orderBy: [{ time: 'asc' }, { id: 'asc' }]
  });
  result.due = plans.length;
  if (plans.length === 0) return result;

  let accessToken: string | null = null;
  const token = async (): Promise<string> => {
    if (accessToken) return accessToken;
    accessToken = await getWechatAccessToken({
      fetch: deps.fetch,
      now,
      appId: config.wechatAppId,
      secret: config.wechatSecret
    });
    return accessToken;
  };

  for (const plan of plans) {
    if (!isReminderMetric(plan.metric)) continue;
    const metric = plan.metric;
    const context = { planId: plan.id, userId: plan.userId, metric, today };
    try {
      if (await hasRecordOnDay(prisma, plan.userId, metric, today)) {
        await prisma.reminderPlan.update({ where: { id: plan.id }, data: { lastSentDay: today } });
        result.skipped += 1;
        continue;
      }
      const template = config.reminderTemplates[metric];
      if (!template) {
        log.warn(context, 'reminder template not configured for metric');
        continue;
      }
      const touser = miniOpenidOf(plan.user);
      if (!touser) {
        await prisma.reminderPlan.update({ where: { id: plan.id }, data: { enabled: false } });
        log.warn(context, 'reminder disabled: user has no mini-program openid');
        result.failed += 1;
        continue;
      }

      const message = buildReminderMessage({ metric, time: plan.time, period: plan.period }, template, touser, today, config.miniprogramState);
      const outcome = await sendSubscribeMessage(deps.fetch, await token(), message);
      await prisma.reminderLog.create({
        data: {
          userId: plan.userId,
          metric,
          templateKey: `${metric}_reminder`,
          scheduledDay: today,
          sentAt: now,
          ok: outcome.ok,
          errcode: outcome.errcode,
          errmsg: outcome.errmsg
        }
      });

      if (outcome.ok) {
        await prisma.reminderPlan.update({
          where: { id: plan.id },
          data: { quota: Math.max(0, plan.quota - 1), lastSentDay: today }
        });
        result.sent += 1;
        continue;
      }

      result.failed += 1;
      const detail = { ...context, errcode: outcome.errcode, errmsg: outcome.errmsg };
      if (outcome.transport) {
        log.warn(detail, 'reminder send failed before reaching WeChat; will retry next tick');
      } else if (outcome.errcode === ERRCODE_QUOTA_EXHAUSTED) {
        await prisma.reminderPlan.update({ where: { id: plan.id }, data: { quota: 0 } });
        log.info(detail, 'reminder quota exhausted or rejected by user');
      } else if (outcome.errcode === ERRCODE_INVALID_OPENID) {
        await prisma.reminderPlan.update({ where: { id: plan.id }, data: { enabled: false } });
        log.warn(detail, 'reminder disabled: WeChat rejected the openid');
      } else if (outcome.errcode === ERRCODE_FIELD_FORMAT) {
        log.error(detail, 'reminder template field format rejected; check WECHAT_TEMPLATE_*_FIELDS');
      } else if (outcome.errcode !== null && ERRCODE_BAD_TOKEN.has(outcome.errcode)) {
        resetWechatTokenCache();
        accessToken = null;
        log.warn(detail, 'reminder access_token rejected; refreshed for the next attempt');
      } else {
        await prisma.reminderPlan.update({ where: { id: plan.id }, data: { lastSentDay: today } });
        log.warn(detail, 'reminder send failed; not retried today');
      }
    } catch (error) {
      result.failed += 1;
      if (error instanceof WechatTokenError) {
        log.error({ ...context, detail: error.causeDetail }, error.message);
        // Every remaining send needs the same token, so stop this tick and try again on the next one.
        break;
      }
      log.error({ ...context, err: error }, 'reminder tick failed for plan');
    }
  }
  return result;
}
