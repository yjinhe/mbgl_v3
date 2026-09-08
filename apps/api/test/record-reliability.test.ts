import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { recordRange } from '../src/services/records.js';
import { localDayKey } from '@tangji/shared';
import { createSqliteSchema } from './setup-db.js';

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tangji-reliable-'));
  prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(dir, 'test.db')}` } } });
  await createSqliteSchema(prisma);
  app = await buildApp({ prisma });
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function account(name: string) {
  const user = await prisma.user.create({ data: { openid: name } });
  return { user, headers: { authorization: `Bearer ${app.jwt.sign({ aud: 'app', userId: user.id })}` } };
}

const glucose = (extra = {}) => ({ value: 6.3, period: 'post_meal_2h', measuredAt: new Date(Date.now() - 60_000).toISOString(), ...extra });

describe('reliable recording and comparable statistics', () => {
  test('retries of one submission return one record, including after other records have been saved', async () => {
    const { user, headers } = await account('retry-user');
    const payload = glucose();
    const first = await app.inject({ method: 'POST', url: '/api/app/records/glucose', headers: { ...headers, 'idempotency-key': 'test_request_123' }, payload });
    expect(first.statusCode).toBe(201);
    await app.inject({ method: 'POST', url: '/api/app/records/glucose', headers, payload });
    const retry = await app.inject({ method: 'POST', url: '/api/app/records/glucose', headers: { ...headers, 'idempotency-key': 'test_request_123' }, payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().record.id).toBe(first.json().record.id);
    expect(await prisma.glucoseRecord.count({ where: { userId: user.id } })).toBe(2);
    expect(await prisma.recordSubmission.count({ where: { userId: user.id } })).toBe(1);
    expect((await prisma.dailySummary.findFirstOrThrow({ where: { userId: user.id } })).count).toBe(2);
  });

  test('a reused key with different data is rejected, while keys are isolated by user', async () => {
    const a = await account('key-user-a');
    const b = await account('key-user-b');
    const payload = glucose();
    const send = (headers: Record<string, string>, value: number) => app.inject({ method: 'POST', url: '/api/app/records/glucose', headers: { ...headers, 'idempotency-key': 'shared_key_123' }, payload: { ...payload, value } });
    expect((await send(a.headers, 6.3)).statusCode).toBe(201);
    const conflicting = await send(a.headers, 8.1);
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await send(b.headers, 8.1)).statusCode).toBe(201);
  });

  test('replaying a deleted record never recreates it', async () => {
    const { user, headers } = await account('deleted-retry');
    const options = { method: 'POST' as const, url: '/api/app/records/glucose', headers: { ...headers, 'idempotency-key': 'deleted_request' }, payload: glucose() };
    const created = await app.inject(options);
    const removed = await app.inject({ method: 'DELETE', url: `/api/app/records/glucose/${created.json().record.id}`, headers });
    expect(removed.statusCode).toBe(204);
    const retry = await app.inject(options);
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('RECORD_UNAVAILABLE');
    expect(await prisma.glucoseRecord.count({ where: { userId: user.id, deletedAt: null } })).toBe(0);
  });

  test('a summary failure rolls back the record and its request key, so a later retry works', async () => {
    const { user, headers } = await account('summary-rollback');
    const options = { method: 'POST' as const, url: '/api/app/records/glucose', headers: { ...headers, 'idempotency-key': 'rollback_request' }, payload: glucose() };
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_summary BEFORE INSERT ON "DailySummary" BEGIN SELECT RAISE(ABORT, 'test summary failure'); END`);
    try {
      expect((await app.inject(options)).statusCode).toBe(500);
      expect(await prisma.glucoseRecord.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.recordSubmission.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_summary');
    }
    expect((await app.inject(options)).statusCode).toBe(201);
  });

  test('edits across days update both daily summaries and keep ownership protection', async () => {
    const a = await account('edit-a');
    const b = await account('edit-b');
    const originalTime = new Date(Date.now() - 3 * 86400000).toISOString();
    const changedTime = new Date(Date.now() - 86400000).toISOString();
    const created = await app.inject({ method: 'POST', url: '/api/app/records/glucose', headers: a.headers, payload: glucose({ measuredAt: originalTime }) });
    const url = `/api/app/records/glucose/${created.json().record.id}`;
    const payload = glucose({ value: 7.4, period: 'post_meal_1h', measuredAt: changedTime, note: '更正' });
    expect((await app.inject({ method: 'PATCH', url, headers: b.headers, payload })).statusCode).toBe(404);
    const changed = await app.inject({ method: 'PATCH', url, headers: a.headers, payload });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().record).toMatchObject({ valueMmol: 7.4, period: 'post_meal_1h', note: '更正' });
    const summaries = await prisma.dailySummary.findMany({ where: { userId: a.user.id } });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.date).toBe(localDayKey(changedTime));
  });

  test('partial edits keep pulse and tags, while explicit null still clears pulse', async () => {
    const { user, headers } = await account('partial-edit');
    const measuredAt = new Date(Date.now() - 60_000).toISOString();
    const created = await app.inject({ method: 'POST', url: '/api/app/records/bp', headers, payload: { sbp: 128, dbp: 82, pulse: 76, period: 'morning', measuredAt, tags: ['运动后'], note: '晨起' } });
    expect(created.statusCode).toBe(201);
    const url = `/api/app/records/bp/${created.json().record.id}`;
    const partial = await app.inject({ method: 'PATCH', url, headers, payload: { sbp: 132, dbp: 84 } });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().record).toMatchObject({ sbp: 132, dbp: 84, pulse: 76, tags: ['运动后'], note: '晨起', period: 'morning' });
    const stored = await prisma.bpRecord.findUniqueOrThrow({ where: { id: created.json().record.id } });
    expect(stored.pulse).toBe(76);
    expect(stored.tags).toBe(JSON.stringify(['运动后']));
    expect(stored.measuredAt.toISOString()).toBe(new Date(measuredAt).toISOString());
    expect((await prisma.bpRecord.count({ where: { userId: user.id } }))).toBe(1);
    const cleared = await app.inject({ method: 'PATCH', url, headers, payload: { sbp: 132, dbp: 84, pulse: null, tags: [] } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().record).toMatchObject({ pulse: null, tags: [] });
  });

  test('glucose statistics filter exact periods, exclude future/deleted/out-of-range rows and retain all points', async () => {
    const { user, headers } = await account('period-stats');
    const now = new Date();
    const boundary = recordRange(7, now).gte;
    await prisma.glucoseRecord.createMany({ data: [
      ...Array.from({ length: 18 }, (_, i) => ({ userId: user.id, valueMmol: 6, period: 'post_meal_1h', measuredAt: new Date(now.getTime() - (i + 1) * 60000) })),
      { userId: user.id, valueMmol: 6, period: 'post_meal_1h', measuredAt: boundary },
      { userId: user.id, valueMmol: 12, period: 'post_meal_2h', measuredAt: now },
      { userId: user.id, valueMmol: 20, period: 'post_meal_1h', measuredAt: new Date(boundary.getTime() - 1) },
      { userId: user.id, valueMmol: 20, period: 'post_meal_1h', measuredAt: new Date(now.getTime() + 86400000) },
      { userId: user.id, valueMmol: 20, period: 'post_meal_1h', measuredAt: now, deletedAt: now }
    ] });
    const res = await app.inject({ url: '/api/app/stats?metric=glucose&range=7&period=post_meal_1h', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ n: 19, avg: 6, period: 'post_meal_1h' });
    expect(res.json().series.points).toHaveLength(19);
    const all = await app.inject({ url: '/api/app/stats?metric=glucose&range=7', headers });
    expect(all.json().n).toBe(20);
    expect((await app.inject({ url: '/api/app/stats?metric=glucose&period=nonsense', headers })).statusCode).toBe(422);
  });

  test('missing pulse is not counted as zero and impossible targets/future measurements are rejected', async () => {
    const { user, headers } = await account('nullable-pulse');
    await prisma.bpRecord.createMany({ data: [
      { userId: user.id, sbp: 120, dbp: 80, pulse: 72, period: 'morning', measuredAt: new Date() },
      { userId: user.id, sbp: 125, dbp: 82, period: 'morning', measuredAt: new Date() }
    ] });
    expect((await app.inject({ url: '/api/app/stats?metric=bp', headers })).json().avgPulse).toBe(72);
    expect((await app.inject({ method: 'PATCH', url: '/api/app/me', headers, payload: { target: { fastingLow: -100, fastingHigh: -50, postMealHigh: -20 } } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/app/records/glucose', headers, payload: glucose({ measuredAt: new Date(Date.now() + 86400000).toISOString() }) })).statusCode).toBe(422);
  });

  test('date range uses Beijing midnight regardless of the process timezone', () => {
    const range = recordRange(7, new Date('2026-09-05T00:30:00+08:00'));
    expect(range.gte.toISOString()).toBe('2026-08-29T16:00:00.000Z');
    expect(range.lte.toISOString()).toBe('2026-09-04T16:30:00.000Z');
  });
});
