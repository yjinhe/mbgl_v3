import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { BP_REMINDER_NOTE, GLUCOSE_PERIOD_MAP, REMINDER_TIPS, localDayKey, type GlucosePeriod } from '@tangji/shared';
import type { MiniprogramState, ReminderTemplate } from '../env.js';
import { getWechatAccessToken, resetWechatTokenCache, WechatTokenError } from './wechat-token.js';

export type ReminderMetric = 'glucose' | 'bp' | 'medication';
/** Metrics whose reminder fires at the plan's own time and is skipped once the metric was recorded that day. */
export type MeasurementMetric = 'glucose' | 'bp';

export const REMINDER_METRICS: readonly ReminderMetric[] = ['glucose', 'bp', 'medication'];
export const MEASUREMENT_METRICS: readonly MeasurementMetric[] = ['glucose', 'bp'];
export const REMINDER_QUOTA_MAX = 30;
// Tolerates a delayed cron run: a plan fires while now - 10min < time <= now (HH:mm string comparison).
export const REMINDER_WINDOW_MINUTES = 10;
export const REMINDER_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// Medication plans fire at each medication's own times (medication spec §4); their stored time is a fixed placeholder.
export const DEFAULT_REMINDER_TIME: Record<ReminderMetric, string> = { glucose: '07:00', bp: '07:30', medication: '00:00' };
export const DEFAULT_GLUCOSE_REMINDER_PERIOD: GlucosePeriod = 'fasting';
export const MEDICATION_TEMPLATE_KEY = 'medication_reminder';
export const MEDICATION_REMINDER_NOTE = '请按医生要求服用';
/** WeChat `thing` fields hold at most 20 characters. */
export const MEDICATION_NAMES_MAX_CHARS = 20;

const SUBSCRIBE_SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';
const ERRCODE_QUOTA_EXHAUSTED = 43101; // user rejected or no remaining one-time subscription
const ERRCODE_INVALID_OPENID = 40003;
const ERRCODE_FIELD_FORMAT = 47003;
const ERRCODE_BAD_TOKEN = new Set([40001, 40014, 42001]); // invalid or expired access_token: refresh and retry next tick

export function isReminderMetric(value: unknown): value is ReminderMetric {
  return value === 'glucose' || value === 'bp' || value === 'medication';
}

export function isMeasurementMetric(value: unknown): value is MeasurementMetric {
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
  const time = metric === 'medication'
    ? DEFAULT_REMINDER_TIME.medication
    : input.time ?? existing?.time ?? DEFAULT_REMINDER_TIME[metric];
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

export interface ReminderWindow {
  /** 'YYYY-MM-DD' in Asia/Shanghai. */
  today: string;
  /** Wall clock 'HH:mm' in Asia/Shanghai (inclusive end of the window). */
  time: string;
  /** Exclusive start of the window, or null when the window would cross midnight. */
  after: string | null;
}

/** Current Asia/Shanghai day key and wall clock, plus the HH:mm filter for plans due in this tick. */
export function reminderWindow(now: Date): ReminderWindow {
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

/** Distinct 'HH:mm' entries of `times` that fall inside the window (after < t <= time), ascending. */
export function slotsInWindow(times: readonly string[], window: Pick<ReminderWindow, 'time' | 'after'>): string[] {
  const inWindow = times.filter((slot) => slot <= window.time && (window.after === null || slot > window.after));
  return [...new Set(inWindow)].sort();
}

/** Parses the JSON `times` column of a medication; malformed or non-'HH:mm' content yields an empty list. */
export function parseStoredTimes(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string' && REMINDER_TIME_PATTERN.test(item));
}

/**
 * Medication names joined with '、' for the 20-character `thing` field (medication spec §3.3): cut to fit and ends with
 * '等' when anything was dropped.
 */
export function medicationNamesField(names: readonly string[]): string {
  const joined = names.join('、');
  const chars = Array.from(joined);
  if (chars.length <= MEDICATION_NAMES_MAX_CHARS) return joined;
  let kept = chars.slice(0, MEDICATION_NAMES_MAX_CHARS - 1).join('');
  while (kept.endsWith('、')) kept = kept.slice(0, -1);
  return `${kept}等`;
}

export function shanghaiDayRange(dayKey: string) {
  const start = new Date(`${dayKey}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

async function hasRecordOnDay(prisma: PrismaClient, userId: string, metric: MeasurementMetric, dayKey: string) {
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

function templateData(template: ReminderTemplate, values: readonly string[]) {
  const data: Record<string, { value: string }> = {};
  template.fields.forEach((field, index) => {
    const value = values[index];
    if (value !== undefined) data[field] = { value };
  });
  return data;
}

/** Builds the subscribe/send payload; values are mapped onto the configured field keys in message order. */
export function buildReminderMessage(
  plan: { metric: MeasurementMetric; time: string; period: string | null },
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
  return { touser, template_id: template.id, page, miniprogram_state: miniprogramState, lang: 'zh_CN', data: templateData(template, values) };
}

/** Medication spec §6.5: one message per slot listing every medication due at that time. */
export function buildMedicationMessage(
  template: ReminderTemplate,
  touser: string,
  dayKey: string,
  slot: string,
  names: readonly string[],
  miniprogramState: MiniprogramState
): SubscribeMessage {
  const values = [`${dayKey} ${slot}`, medicationNamesField(names), MEDICATION_REMINDER_NOTE];
  return {
    touser,
    template_id: template.id,
    page: `pages/medications/index?slot=${slot}&from=reminder`,
    miniprogram_state: miniprogramState,
    lang: 'zh_CN',
    data: templateData(template, values)
  };
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
  reminderTemplates: { glucose?: ReminderTemplate; bp?: ReminderTemplate; medication?: ReminderTemplate };
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
  /** Measurement plans (glucose/bp) due in this window and not handled today. */
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Medication slots due in this window without a ReminderLog row for today. */
  medicationDue: number;
  medicationSent: number;
  /** Slots whose medications were all checked in before the reminder fired. */
  medicationSkipped: number;
  medicationFailed: number;
}

export function remindersConfigured(config: ReminderConfig) {
  const { glucose, bp, medication } = config.reminderTemplates;
  return Boolean(config.wechatAppId && config.wechatSecret && (glucose || bp || medication));
}

interface TickContext {
  prisma: PrismaClient;
  deps: ReminderTickDeps;
  window: ReminderWindow;
  result: ReminderTickResult;
  /** Fetches the access_token once per tick and reuses it for every send. */
  token(): Promise<string>;
  /** Drops the cached token after WeChat rejected it, so the next attempt fetches a fresh one. */
  invalidateToken(): void;
}

/**
 * One cron tick: the measurement pass (reminder spec §6) sends one message per due glucose/bp plan that was not
 * recorded today; the medication pass (medication spec §6) sends one message per due medication slot that is not yet
 * fully checked in. Both passes share the access_token, the 10-minute window and the errcode handling.
 */
export async function runReminderTick(prisma: PrismaClient, deps: ReminderTickDeps): Promise<ReminderTickResult> {
  const window = reminderWindow(deps.now);
  const result: ReminderTickResult = {
    today: window.today,
    time: window.time,
    due: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    medicationDue: 0,
    medicationSent: 0,
    medicationSkipped: 0,
    medicationFailed: 0
  };
  let accessToken: string | null = null;
  const ctx: TickContext = {
    prisma,
    deps,
    window,
    result,
    async token() {
      if (accessToken) return accessToken;
      accessToken = await getWechatAccessToken({
        fetch: deps.fetch,
        now: deps.now,
        appId: deps.config.wechatAppId,
        secret: deps.config.wechatSecret
      });
      return accessToken;
    },
    invalidateToken() {
      resetWechatTokenCache();
      accessToken = null;
    }
  };
  // Every send needs the same token: once fetching it fails, stop the whole tick and try again on the next one.
  if (await sendMeasurementReminders(ctx)) await sendMedicationReminders(ctx);
  return result;
}

/**
 * Applies the plan-level consequence of a WeChat errcode shared by both passes (43101 → quota 0, 40003 → disabled,
 * 47003 → configuration error, bad token → refresh). Returns false for errcodes the caller must handle itself.
 */
async function handleWechatError(ctx: TickContext, planId: string, detail: object, outcome: SendOutcome): Promise<boolean> {
  const { prisma, deps: { log } } = ctx;
  if (outcome.errcode === ERRCODE_QUOTA_EXHAUSTED) {
    await prisma.reminderPlan.update({ where: { id: planId }, data: { quota: 0 } });
    log.info(detail, 'reminder quota exhausted or rejected by user');
  } else if (outcome.errcode === ERRCODE_INVALID_OPENID) {
    await prisma.reminderPlan.update({ where: { id: planId }, data: { enabled: false } });
    log.warn(detail, 'reminder disabled: WeChat rejected the openid');
  } else if (outcome.errcode === ERRCODE_FIELD_FORMAT) {
    log.error(detail, 'reminder template field format rejected; check WECHAT_TEMPLATE_*_FIELDS');
  } else if (outcome.errcode !== null && ERRCODE_BAD_TOKEN.has(outcome.errcode)) {
    ctx.invalidateToken();
    log.warn(detail, 'reminder access_token rejected; refreshed for the next attempt');
  } else {
    return false;
  }
  return true;
}

/** Returns false when the tick must stop because no access_token could be obtained. */
async function sendMeasurementReminders(ctx: TickContext): Promise<boolean> {
  const { prisma, deps: { now, config, log }, window: { today, time, after }, result } = ctx;
  const plans = await prisma.reminderPlan.findMany({
    where: {
      metric: { in: [...MEASUREMENT_METRICS] },
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

  for (const plan of plans) {
    if (!isMeasurementMetric(plan.metric)) continue;
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
      const outcome = await sendSubscribeMessage(ctx.deps.fetch, await ctx.token(), message);
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
      } else if (!(await handleWechatError(ctx, plan.id, detail, outcome))) {
        await prisma.reminderPlan.update({ where: { id: plan.id }, data: { lastSentDay: today } });
        log.warn(detail, 'reminder send failed; not retried today');
      }
    } catch (error) {
      result.failed += 1;
      if (error instanceof WechatTokenError) {
        log.error({ ...context, detail: error.causeDetail }, error.message);
        return false;
      }
      log.error({ ...context, err: error }, 'reminder tick failed for plan');
    }
  }
  return true;
}

/**
 * Medication spec §6: for each enabled medication plan with quota, every slot of the user's unarchived medications that
 * falls in the window gets at most one ReminderLog row per day (sent, failed, or the `all_taken` placeholder), so a slot
 * is never retried the same day.
 */
async function sendMedicationReminders(ctx: TickContext): Promise<void> {
  const { prisma, deps: { now, config, log }, window: { today, time, after }, result } = ctx;
  const plans = await prisma.reminderPlan.findMany({
    where: {
      metric: 'medication',
      enabled: true,
      quota: { gt: 0 },
      user: { deactivatedAt: null, medications: { some: { archivedAt: null } } }
    },
    include: {
      user: {
        select: {
          id: true,
          openid: true,
          miniOpenid: true,
          medications: {
            where: { archivedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, times: true }
          }
        }
      }
    },
    orderBy: { id: 'asc' }
  });

  for (const plan of plans) {
    const medications = plan.user.medications.map((item) => ({ id: item.id, name: item.name, times: parseStoredTimes(item.times) }));
    const slots = slotsInWindow(medications.flatMap((item) => item.times), { time, after });
    if (slots.length === 0) continue;
    const context = { planId: plan.id, userId: plan.userId, metric: 'medication', today };
    let quota = plan.quota;
    try {
      for (const slot of slots) {
        if (quota <= 0) break;
        const handled = await prisma.reminderLog.findFirst({
          where: { userId: plan.userId, templateKey: MEDICATION_TEMPLATE_KEY, scheduledDay: today, slot },
          select: { id: true }
        });
        if (handled) continue;
        result.medicationDue += 1;

        const due = medications.filter((item) => item.times.includes(slot));
        const taken = await prisma.medicationLog.count({
          where: { medicationId: { in: due.map((item) => item.id) }, day: today, slot }
        });
        if (taken >= due.length) {
          await prisma.reminderLog.create({
            data: { userId: plan.userId, metric: 'medication', templateKey: MEDICATION_TEMPLATE_KEY, scheduledDay: today, slot, sentAt: now, ok: true, errmsg: 'all_taken' }
          });
          result.medicationSkipped += 1;
          continue;
        }

        const template = config.reminderTemplates.medication;
        if (!template) {
          log.warn(context, 'reminder template not configured for metric');
          break;
        }
        const touser = miniOpenidOf(plan.user);
        if (!touser) {
          await prisma.reminderPlan.update({ where: { id: plan.id }, data: { enabled: false } });
          log.warn(context, 'reminder disabled: user has no mini-program openid');
          result.medicationFailed += 1;
          break;
        }

        const message = buildMedicationMessage(template, touser, today, slot, due.map((item) => item.name), config.miniprogramState);
        const outcome = await sendSubscribeMessage(ctx.deps.fetch, await ctx.token(), message);
        await prisma.reminderLog.create({
          data: {
            userId: plan.userId,
            metric: 'medication',
            templateKey: MEDICATION_TEMPLATE_KEY,
            scheduledDay: today,
            slot,
            sentAt: now,
            ok: outcome.ok,
            errcode: outcome.errcode,
            errmsg: outcome.errmsg
          }
        });

        if (outcome.ok) {
          quota -= 1;
          await prisma.reminderPlan.update({ where: { id: plan.id }, data: { quota } });
          result.medicationSent += 1;
          continue;
        }

        result.medicationFailed += 1;
        const detail = { ...context, slot, errcode: outcome.errcode, errmsg: outcome.errmsg };
        if (outcome.transport) {
          log.warn(detail, 'medication reminder send failed before reaching WeChat; slot not retried today');
        } else if (!(await handleWechatError(ctx, plan.id, detail, outcome))) {
          log.warn(detail, 'medication reminder send failed; slot not retried today');
        }
        // Nothing more can be delivered to this user today once the quota is gone or the openid is rejected.
        if (outcome.errcode === ERRCODE_QUOTA_EXHAUSTED || outcome.errcode === ERRCODE_INVALID_OPENID) break;
      }
    } catch (error) {
      result.medicationFailed += 1;
      if (error instanceof WechatTokenError) {
        log.error({ ...context, detail: error.causeDetail }, error.message);
        return;
      }
      log.error({ ...context, err: error }, 'reminder tick failed for plan');
    }
  }
}
