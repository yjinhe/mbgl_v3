import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_GLUCOSE_TARGET,
  addDaysToKey,
  localDayKey,
  bpSafetyAlert,
  bpStatus,
  coefficientOfVariation,
  dayKeysFromDates,
  displayGlucose,
  glucoseSafetyAlert,
  glucoseStatus,
  glucoseTir,
  gmiFromAverage,
  lipidOverallStatus,
  lipidStatus,
  standardDeviation,
  streakFromDayKeys,
  uricSafetyAlert,
  uricStatus,
  uricThreshold,
  validateBp,
  validateGlucose,
  validateLipid,
  validateUric,
  type GlucosePeriod,
  type Metric,
  type Sex,
  type Unit
} from '@tangji/shared';

export const METRICS: Metric[] = ['glucose', 'bp', 'lipid', 'uric'];

export const GLUCOSE_PERIODS = new Set([
  'fasting',
  'post_meal_1h',
  'post_meal_2h',
  'after_breakfast',
  'before_lunch',
  'after_lunch',
  'random',
  'before_dinner',
  'after_dinner',
  'bedtime',
  'dawn'
]);
const BP_PERIODS = new Set(['morning', 'daytime', 'evening', 'night']);
const COMMON_RECORD_FIELDS = ['measuredAt', 'note'] as const;
const METRIC_RECORD_FIELDS: Record<Metric, ReadonlySet<string>> = {
  glucose: new Set([...COMMON_RECORD_FIELDS, 'value', 'unit', 'period', 'tags']),
  bp: new Set([...COMMON_RECORD_FIELDS, 'sbp', 'dbp', 'pulse', 'period', 'tags']),
  lipid: new Set([...COMMON_RECORD_FIELDS, 'tc', 'tg', 'ldl', 'hdl', 'fasting']),
  uric: new Set([...COMMON_RECORD_FIELDS, 'value', 'fasting'])
};
const MAX_NOTE_LENGTH = 50;
const MAX_TAG_COUNT = 12;
const MAX_TAG_LENGTH = 32;
const MAX_TAGS_TOTAL_LENGTH = 256;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

type ValidationResult = { ok: true; valueMmol?: number } | { ok: false; message: string };

function invalid(message: string): ValidationResult {
  return { ok: false, message };
}

function isRecordBody(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyAllowedFields(metric: Metric, body: Record<string, unknown>): boolean {
  return Object.keys(body).every((field) => METRIC_RECORD_FIELDS[metric].has(field));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidIsoDateTime(value: string): boolean {
  if (!ISO_DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  return month >= 1 && month <= 12
    && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59;
}

function validateCommonRecordFields(body: Record<string, unknown>): ValidationResult {
  if (body.measuredAt !== undefined && (typeof body.measuredAt !== 'string' || body.measuredAt.length > 40 || !isValidIsoDateTime(body.measuredAt))) {
    return invalid('测量时间不正确');
  }
  if (typeof body.measuredAt === 'string' && Date.parse(body.measuredAt) > Date.now() + 60_000) {
    return invalid('测量时间不能晚于现在');
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > MAX_NOTE_LENGTH)) {
    return invalid(`备注不能超过 ${MAX_NOTE_LENGTH} 个字符`);
  }
  return { ok: true };
}

function validateTags(tags: unknown): ValidationResult {
  if (tags === undefined) return { ok: true };
  if (!Array.isArray(tags) || tags.length > MAX_TAG_COUNT) return invalid('标签格式不正确');
  let totalLength = 0;
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.length === 0 || tag.length > MAX_TAG_LENGTH || tag.trim() !== tag || seen.has(tag)) {
      return invalid('标签格式不正确');
    }
    seen.add(tag);
    totalLength += tag.length;
    if (totalLength > MAX_TAGS_TOTAL_LENGTH) return invalid('标签内容过长');
  }
  return { ok: true };
}

export function toNum(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') return value.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function userTarget(user: {
  fastingLow: unknown;
  fastingHigh: unknown;
  postMealHigh: unknown;
}) {
  return {
    fastingLow: toNum(user.fastingLow) ?? DEFAULT_GLUCOSE_TARGET.fastingLow,
    fastingHigh: toNum(user.fastingHigh) ?? DEFAULT_GLUCOSE_TARGET.fastingHigh,
    postMealHigh: toNum(user.postMealHigh) ?? DEFAULT_GLUCOSE_TARGET.postMealHigh
  };
}

export function serializeGlucose(record: any, user: any, unit: Unit = 'mmol') {
  const valueMmol = toNum(record.valueMmol) ?? 0;
  const period = record.period as GlucosePeriod;
  const status = glucoseStatus(valueMmol, period, userTarget(user));
  return {
    id: record.id,
    metric: 'glucose' as const,
    valueMmol,
    displayValue: displayGlucose(valueMmol, unit),
    displayUnit: unit === 'mgdl' ? 'mg/dL' : 'mmol/L',
    period,
    periodName: periodName(period),
    measuredAt: record.measuredAt.toISOString(),
    tags: parseTags(record.tags),
    note: record.note,
    status
  };
}

export function serializeBp(record: any) {
  return {
    id: record.id,
    metric: 'bp' as const,
    sbp: record.sbp,
    dbp: record.dbp,
    pulse: record.pulse,
    period: record.period,
    periodName: bpPeriodName(record.period),
    measuredAt: record.measuredAt.toISOString(),
    tags: parseTags(record.tags),
    note: record.note,
    status: bpStatus(record.sbp, record.dbp)
  };
}

export function serializeLipid(record: any) {
  const values = {
    tc: toNum(record.tc),
    tg: toNum(record.tg),
    ldl: toNum(record.ldl),
    hdl: toNum(record.hdl)
  };
  return {
    id: record.id,
    metric: 'lipid' as const,
    ...values,
    fasting: record.fasting,
    measuredAt: record.measuredAt.toISOString(),
    note: record.note,
    itemStatus: Object.fromEntries(
      (['tc', 'tg', 'ldl', 'hdl'] as const).map((key) => [key, values[key] == null ? null : lipidStatus(key, values[key]!).key])
    ),
    status: lipidOverallStatus(values)
  };
}

export function serializeUric(record: any, sex: Sex) {
  return {
    id: record.id,
    metric: 'uric' as const,
    value: record.value,
    fasting: record.fasting,
    measuredAt: record.measuredAt.toISOString(),
    note: record.note,
    threshold: uricThreshold(sex),
    status: uricStatus(record.value, sex)
  };
}

type SerializedRecordMap = {
  glucose: ReturnType<typeof serializeGlucose>;
  bp: ReturnType<typeof serializeBp>;
  lipid: ReturnType<typeof serializeLipid>;
  uric: ReturnType<typeof serializeUric>;
};

export function serializeRecord<M extends Metric>(metric: M, record: any, user: any): SerializedRecordMap[M] {
  if (metric === 'glucose') return serializeGlucose(record, user, user.unit) as SerializedRecordMap[M];
  if (metric === 'bp') return serializeBp(record) as SerializedRecordMap[M];
  if (metric === 'lipid') return serializeLipid(record) as SerializedRecordMap[M];
  return serializeUric(record, user.sex) as SerializedRecordMap[M];
}

export function periodName(period: string): string {
  return (
    {
      fasting: '空腹',
      post_meal_1h: '餐后1小时',
      post_meal_2h: '餐后2小时',
      after_breakfast: '早餐后',
      before_lunch: '午餐前',
      after_lunch: '午餐后',
      random: '随机',
      before_dinner: '晚餐前',
      after_dinner: '晚餐后',
      bedtime: '睡前',
      dawn: '凌晨'
    } as Record<string, string>
  )[period] ?? period;
}

export function bpPeriodName(period: string): string {
  return ({ morning: '晨起', daytime: '白天', evening: '晚间', night: '夜间' } as Record<string, string>)[period] ?? period;
}

export async function recomputeDailySummary(prisma: PrismaClient | Prisma.TransactionClient, userId: string, dateKey: string, target = DEFAULT_GLUCOSE_TARGET) {
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 86400000);
  const records = await prisma.glucoseRecord.findMany({
    where: { userId, deletedAt: null, measuredAt: { gte: start, lt: end } }
  });
  if (records.length === 0) {
    await prisma.dailySummary.deleteMany({ where: { userId, date: dateKey } });
    return;
  }
  const values = records.map((record) => toNum(record.valueMmol) ?? 0);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const okCount = records.filter((record) => glucoseStatus(toNum(record.valueMmol) ?? 0, record.period as GlucosePeriod, target).key === 'ok').length;
  await prisma.dailySummary.upsert({
    where: { userId_date: { userId, date: dateKey } },
    update: { avg, max: Math.max(...values), min: Math.min(...values), count: values.length, okCount },
    create: { userId, date: dateKey, avg, max: Math.max(...values), min: Math.min(...values), count: values.length, okCount }
  });
}

export function metricSafety(metric: Metric, body: any): 'low' | 'high' | null {
  if (metric === 'glucose') return glucoseSafetyAlert(body.valueMmol);
  if (metric === 'bp') return bpSafetyAlert(body.sbp, body.dbp);
  if (metric === 'uric') return uricSafetyAlert(body.value);
  return null;
}

export function validateMetricInput(metric: Metric, body: unknown, unit: Unit = 'mmol'): ValidationResult {
  if (!isRecordBody(body) || !hasOnlyAllowedFields(metric, body)) return invalid('请求参数不正确');
  const common = validateCommonRecordFields(body);
  if (!common.ok) return common;

  if (metric === 'glucose') {
    if (!isFiniteNumber(body.value)) return invalid('请输入血糖值');
    if (body.unit !== undefined && body.unit !== 'mmol' && body.unit !== 'mgdl') return invalid('血糖单位不正确');
    if (body.period !== undefined && (typeof body.period !== 'string' || !GLUCOSE_PERIODS.has(body.period))) {
      return invalid('测量时段不正确');
    }
    const tags = validateTags(body.tags);
    if (!tags.ok) return tags;
    const result = validateGlucose(body.value, unit);
    return result.ok ? { ok: true, valueMmol: result.valueMmol } : invalid(result.message ?? '请输入血糖值');
  }
  if (metric === 'bp') {
    if (!isFiniteNumber(body.sbp) || !isFiniteNumber(body.dbp)) return invalid('请输入血压值');
    if (body.pulse !== undefined && body.pulse !== null && !isFiniteNumber(body.pulse)) return invalid('请输入有效范围内的脉搏值');
    if (body.period !== undefined && (typeof body.period !== 'string' || !BP_PERIODS.has(body.period))) {
      return invalid('测量时段不正确');
    }
    const tags = validateTags(body.tags);
    if (!tags.ok) return tags;
    const result = validateBp({ sbp: body.sbp, dbp: body.dbp, pulse: body.pulse == null ? null : body.pulse });
    return result.ok ? { ok: true } : invalid(result.message ?? '请输入血压值');
  }
  if (metric === 'lipid') {
    if (body.fasting !== undefined && typeof body.fasting !== 'boolean') return invalid('空腹状态不正确');
    const values = { tc: body.tc, tg: body.tg, ldl: body.ldl, hdl: body.hdl };
    for (const value of Object.values(values)) {
      if (value !== undefined && value !== null && !isFiniteNumber(value)) return invalid('血脂数值格式不正确');
    }
    const result = validateLipid(values as { tc?: number | null; tg?: number | null; ldl?: number | null; hdl?: number | null });
    return result.ok ? { ok: true } : invalid(result.message ?? '请至少填写一项血脂指标');
  }
  if (!isFiniteNumber(body.value)) return invalid('请输入尿酸值');
  if (body.fasting !== undefined && typeof body.fasting !== 'boolean') return invalid('空腹状态不正确');
  const result = validateUric(body.value);
  return result.ok ? { ok: true } : invalid(result.message ?? '请输入尿酸值');
}

export function recordRange(range: number, now = new Date()) {
  const startKey = addDaysToKey(localDayKey(now), 1 - range);
  return { gte: new Date(`${startKey}T00:00:00+08:00`), lte: now };
}

export async function statsForMetric(prisma: PrismaClient, userId: string, user: any, metric: Metric, range: number, period?: GlucosePeriod) {
  const measuredAt = recordRange(range);
  if (metric === 'glucose') {
    const records = await prisma.glucoseRecord.findMany({ where: { userId, deletedAt: null, measuredAt, ...(period ? { period } : {}) }, orderBy: [{ measuredAt: 'asc' }, { id: 'asc' }] });
    const values = records.map((record) => toNum(record.valueMmol) ?? 0);
    const tir = glucoseTir(values);
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return {
      range,
      period: period ?? 'all',
      n: records.length,
      avg,
      sd: standardDeviation(values),
      cv: coefficientOfVariation(values),
      tirLow: tir.low,
      tirIn: tir.inRange,
      tirHigh: tir.high,
      okRate: records.length ? records.filter((r) => glucoseStatus(toNum(r.valueMmol) ?? 0, r.period as GlucosePeriod, userTarget(user)).key === 'ok').length / records.length : 0,
      gmi: gmiFromAverage(avg),
      max: values.length ? Math.max(...values) : null,
      min: values.length ? Math.min(...values) : null,
      series: { mode: 'detail', points: records.map((record) => serializeGlucose(record, user, user.unit)) }
    };
  }
  if (metric === 'bp') {
    const records = await prisma.bpRecord.findMany({ where: { userId, deletedAt: null, measuredAt }, orderBy: { measuredAt: 'asc' } });
    const pulses = records.flatMap((record) => record.pulse == null ? [] : [record.pulse]);
    return {
      n: records.length,
      avgSbp: records.length ? Math.round(records.reduce((sum, r) => sum + r.sbp, 0) / records.length) : 0,
      avgDbp: records.length ? Math.round(records.reduce((sum, r) => sum + r.dbp, 0) / records.length) : 0,
      avgPulse: pulses.length ? Math.round(pulses.reduce((sum, value) => sum + value, 0) / pulses.length) : null,
      okRate: records.length ? records.filter((r) => bpStatus(r.sbp, r.dbp).key === 'ok').length / records.length : 0,
      series: records.map(serializeBp)
    };
  }
  if (metric === 'lipid') {
    const records = await prisma.lipidRecord.findMany({ where: { userId, deletedAt: null, measuredAt }, orderBy: { measuredAt: 'asc' } });
    return { n: records.length, latest: records.length ? serializeLipid(records.at(-1)) : null, series: records.map(serializeLipid) };
  }
  const records = await prisma.uricRecord.findMany({ where: { userId, deletedAt: null, measuredAt }, orderBy: { measuredAt: 'asc' } });
  return {
    n: records.length,
    avg: records.length ? Math.round(records.reduce((sum, r) => sum + r.value, 0) / records.length) : 0,
    latest: records.length ? serializeUric(records.at(-1), user.sex) : null,
    okRate: records.length ? records.filter((r) => uricStatus(r.value, user.sex).key === 'ok').length / records.length : 0,
    threshold: uricThreshold(user.sex),
    series: records.map((record) => serializeUric(record, user.sex))
  };
}

export async function userStats(prisma: PrismaClient, userId: string) {
  const [g, b, l, u] = await Promise.all([
    prisma.glucoseRecord.findMany({ where: { userId, deletedAt: null }, select: { measuredAt: true } }),
    prisma.bpRecord.findMany({ where: { userId, deletedAt: null }, select: { measuredAt: true } }),
    prisma.lipidRecord.findMany({ where: { userId, deletedAt: null }, select: { measuredAt: true } }),
    prisma.uricRecord.findMany({ where: { userId, deletedAt: null }, select: { measuredAt: true } })
  ]);
  const dates = [...g, ...b, ...l, ...u].map((r) => r.measuredAt);
  return { totalRecords: dates.length, coveredDays: new Set(dayKeysFromDates(dates)).size, streak: streakFromDayKeys(dayKeysFromDates(dates)) };
}
