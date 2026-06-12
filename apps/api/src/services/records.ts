import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_GLUCOSE_TARGET,
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

export function serializeRecord(metric: Metric, record: any, user: any) {
  if (metric === 'glucose') return serializeGlucose(record, user, user.unit);
  if (metric === 'bp') return serializeBp(record);
  if (metric === 'lipid') return serializeLipid(record);
  return serializeUric(record, user.sex);
}

export function periodName(period: string): string {
  return (
    {
      fasting: '空腹',
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

export async function recomputeDailySummary(prisma: PrismaClient, userId: string, dateKey: string, target = DEFAULT_GLUCOSE_TARGET) {
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

export function validateMetricInput(metric: Metric, body: any, unit: Unit = 'mmol') {
  if (metric === 'glucose') return validateGlucose(Number(body.value), unit);
  if (metric === 'bp') return validateBp({ sbp: Number(body.sbp), dbp: Number(body.dbp), pulse: body.pulse == null ? null : Number(body.pulse) });
  if (metric === 'lipid') {
    return validateLipid({
      tc: body.tc == null ? null : Number(body.tc),
      tg: body.tg == null ? null : Number(body.tg),
      ldl: body.ldl == null ? null : Number(body.ldl),
      hdl: body.hdl == null ? null : Number(body.hdl)
    });
  }
  return validateUric(Number(body.value));
}

export async function statsForMetric(prisma: PrismaClient, userId: string, user: any, metric: Metric, range: number) {
  const since = new Date(Date.now() - (range - 1) * 86400000);
  since.setHours(0, 0, 0, 0);
  if (metric === 'glucose') {
    const records = await prisma.glucoseRecord.findMany({ where: { userId, deletedAt: null, measuredAt: { gte: since } }, orderBy: { measuredAt: 'asc' } });
    const values = records.map((record) => toNum(record.valueMmol) ?? 0);
    const tir = glucoseTir(values);
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return {
      range,
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
      series: { mode: range <= 7 ? 'detail' : 'summary', points: records.map((record) => serializeGlucose(record, user)) }
    };
  }
  if (metric === 'bp') {
    const records = await prisma.bpRecord.findMany({ where: { userId, deletedAt: null, measuredAt: { gte: since } }, orderBy: { measuredAt: 'asc' } });
    return {
      n: records.length,
      avgSbp: records.length ? Math.round(records.reduce((sum, r) => sum + r.sbp, 0) / records.length) : 0,
      avgDbp: records.length ? Math.round(records.reduce((sum, r) => sum + r.dbp, 0) / records.length) : 0,
      avgPulse: records.length ? Math.round(records.reduce((sum, r) => sum + (r.pulse ?? 0), 0) / records.length) : 0,
      okRate: records.length ? records.filter((r) => bpStatus(r.sbp, r.dbp).key === 'ok').length / records.length : 0,
      series: records.map(serializeBp)
    };
  }
  if (metric === 'lipid') {
    const records = await prisma.lipidRecord.findMany({ where: { userId, deletedAt: null }, orderBy: { measuredAt: 'asc' } });
    return { n: records.length, latest: records.length ? serializeLipid(records.at(-1)) : null, series: records.map(serializeLipid) };
  }
  const records = await prisma.uricRecord.findMany({ where: { userId, deletedAt: null, measuredAt: { gte: since } }, orderBy: { measuredAt: 'asc' } });
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
