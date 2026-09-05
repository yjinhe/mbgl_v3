import { Prisma, type PrismaClient } from '@prisma/client';
import { addDaysToKey, localDayKey, type Metric } from '@tangji/shared';
import { serializeRecord } from './records.js';

type Activity = 'all' | 'new_without_records' | 'with_records' | 'inactive';
export interface AdminUserQuery { q: string; activity: Activity; days: 7 | 30; page: number; limit: number }

// Prisma stores DateTime as milliseconds; the text branch supports older SQLite defaults.
const enteredAt = Prisma.sql`CASE WHEN typeof("createdAt") = 'text' THEN CAST(strftime('%s', "createdAt") AS INTEGER) * 1000 ELSE "createdAt" END`;
const activeRecords = Prisma.sql`
  SELECT "id", "userId", 'glucose' AS metric, ${enteredAt} AS enteredAt FROM "GlucoseRecord" WHERE "deletedAt" IS NULL
  UNION ALL SELECT "id", "userId", 'bp', ${enteredAt} FROM "BpRecord" WHERE "deletedAt" IS NULL
  UNION ALL SELECT "id", "userId", 'lipid', ${enteredAt} FROM "LipidRecord" WHERE "deletedAt" IS NULL
  UNION ALL SELECT "id", "userId", 'uric', ${enteredAt} FROM "UricRecord" WHERE "deletedAt" IS NULL`;

export function adminWindow(days: number, now = new Date()) {
  return { from: new Date(`${addDaysToKey(localDayKey(now), -(days - 1))}T00:00:00+08:00`), to: now };
}

function iso(value: Date | number | bigint | string | Prisma.Decimal | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const timestamp = typeof value === 'string' && !/^\d+$/.test(value) ? value : Number(value);
  return new Date(timestamp).toISOString();
}

export async function listAdminUsers(prisma: PrismaClient, query: AdminUserQuery, now = new Date()) {
  const from7 = adminWindow(7, now).from.getTime();
  const from30 = adminWindow(30, now).from.getTime();
  const since = query.days === 7 ? from7 : from30;
  const cte = Prisma.sql`WITH records AS (${activeRecords}), activity AS (
    SELECT "userId", COUNT(*) AS totalRecords, MAX(enteredAt) AS lastRecordedAt,
      SUM(CASE WHEN enteredAt >= ${from7} AND enteredAt <= ${now.getTime()} THEN 1 ELSE 0 END) AS records7d,
      SUM(CASE WHEN enteredAt >= ${from30} AND enteredAt <= ${now.getTime()} THEN 1 ELSE 0 END) AS records30d
    FROM records GROUP BY "userId"
  )`;
  const recentCount = query.days === 7 ? Prisma.sql`COALESCE(a.records7d, 0)` : Prisma.sql`COALESCE(a.records30d, 0)`;
  const userCreatedAt = Prisma.sql`CASE WHEN typeof(u."createdAt") = 'text' THEN CAST(strftime('%s', u."createdAt") AS INTEGER) * 1000 ELSE u."createdAt" END`;
  const activityFilter = query.activity === 'new_without_records'
    ? Prisma.sql`AND COALESCE(a.totalRecords, 0) = 0 AND ${userCreatedAt} >= ${since} AND ${userCreatedAt} <= ${now.getTime()}`
    : query.activity === 'with_records' ? Prisma.sql`AND COALESCE(a.totalRecords, 0) > 0`
      : query.activity === 'inactive' ? Prisma.sql`AND COALESCE(a.totalRecords, 0) > 0 AND ${recentCount} = 0` : Prisma.empty;
  const where = Prisma.sql`WHERE u."deactivatedAt" IS NULL
    AND (${query.q} = '' OR instr(lower(u."nickname"), lower(${query.q})) > 0
      OR instr(lower(u."adminNote"), lower(${query.q})) > 0 OR instr(lower(u."id"), lower(${query.q})) > 0)
    ${activityFilter}`;
  const [rows, totals] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ id: string; nickname: string; adminNote: string; createdAt: Date | number | string; hasAvatar: bigint; totalRecords: bigint; records7d: bigint; records30d: bigint; lastRecordedAt: bigint | null }>>(
      Prisma.sql`${cte} SELECT u."id", u."nickname", u."adminNote", ${userCreatedAt} AS createdAt,
        CASE WHEN u."avatarUrl" IS NOT NULL AND length(u."avatarUrl") > 0 THEN 1 ELSE 0 END AS hasAvatar,
        COALESCE(a.totalRecords, 0) AS totalRecords, COALESCE(a.records7d, 0) AS records7d,
        COALESCE(a.records30d, 0) AS records30d, a.lastRecordedAt
      FROM "User" u LEFT JOIN activity a ON a."userId" = u."id" ${where}
      ORDER BY createdAt DESC, u."id" DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*) AS total
      FROM "User" u LEFT JOIN activity a ON a."userId" = u."id" ${where}`)
  ]);
  return {
    items: rows.map((row) => ({ id: row.id, nickname: row.nickname, adminNote: row.adminNote,
      hasAvatar: Boolean(row.hasAvatar), createdAt: iso(row.createdAt), lastRecordedAt: iso(row.lastRecordedAt),
      totalRecords: Number(row.totalRecords), records7d: Number(row.records7d), records30d: Number(row.records30d) })),
    page: query.page, limit: query.limit, total: Number(totals[0]?.total ?? 0),
    period: { timezone: 'Asia/Shanghai', from7: new Date(from7).toISOString(), from30: new Date(from30).toISOString(), to: now.toISOString() }
  };
}

export async function adminUserRecords(prisma: PrismaClient, userId: string, query: { metric: Metric | 'all'; page: number; limit: number }) {
  const user = await prisma.user.findFirst({ where: { id: userId, deactivatedAt: null }, select: {
    id: true, nickname: true, adminNote: true, avatarUrl: true, createdAt: true,
    unit: true, sex: true, fastingLow: true, fastingHigh: true, postMealHigh: true
  } });
  if (!user) return null;
  const condition = Prisma.sql`WHERE "userId" = ${userId} ${query.metric === 'all' ? Prisma.empty : Prisma.sql`AND metric = ${query.metric}`}`;
  const [refs, count] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ id: string; metric: Metric }>>(Prisma.sql`WITH records AS (${activeRecords})
      SELECT id, metric FROM records ${condition} ORDER BY enteredAt DESC, id DESC, metric ASC
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`WITH records AS (${activeRecords}) SELECT COUNT(*) AS total FROM records ${condition}`)
  ]);
  const ids = (metric: Metric) => refs.filter((ref) => ref.metric === metric).map((ref) => ref.id);
  const [glucose, bp, lipid, uric] = await Promise.all([
    prisma.glucoseRecord.findMany({ where: { id: { in: ids('glucose') }, userId, deletedAt: null } }),
    prisma.bpRecord.findMany({ where: { id: { in: ids('bp') }, userId, deletedAt: null } }),
    prisma.lipidRecord.findMany({ where: { id: { in: ids('lipid') }, userId, deletedAt: null } }),
    prisma.uricRecord.findMany({ where: { id: { in: ids('uric') }, userId, deletedAt: null } })
  ]);
  const recordMap = new Map<string, Record<string, unknown>>();
  for (const [metric, records] of [['glucose', glucose], ['bp', bp], ['lipid', lipid], ['uric', uric]] as const) {
    for (const record of records) recordMap.set(`${metric}:${record.id}`, { ...serializeRecord(metric, record, user), createdAt: record.createdAt.toISOString() });
  }
  return {
    user: { id: user.id, nickname: user.nickname, adminNote: user.adminNote, avatarUrl: user.avatarUrl, createdAt: user.createdAt.toISOString() },
    items: refs.flatMap((ref) => { const record = recordMap.get(`${ref.metric}:${ref.id}`); return record ? [record] : []; }),
    page: query.page, limit: query.limit, total: Number(count[0]?.total ?? 0), timezone: 'Asia/Shanghai'
  };
}
