import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { adminWindow, listAdminUsers } from '../src/services/admin-users.js';
import { createSqliteSchema } from './setup-db.js';

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken: string;
let appToken: string;
let pharmacyToken: string;
let activeId: string;
let emptyId: string;
let inactiveId: string;
let deactivatedId: string;
let deletedId: string;
const now = new Date();
const start7 = adminWindow(7, now).from;
const oldDate = new Date(now.getTime() - 40 * 86400000);

beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tangji-admin-users-'));
  prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(directory, 'test.db')}` } } });
  await createSqliteSchema(prisma);
  app = await buildApp({ prisma });
  const admin = await prisma.adminUser.create({ data: { username: 'test-admin', passwordHash: 'not-returned-admin-secret' } });
  const pharmacy = await prisma.pharmacy.create({ data: { name: '权限隔离测试药房' } });
  const staff = await prisma.pharmacyStaff.create({ data: { pharmacyId: pharmacy.id, username: 'test-staff', passwordHash: 'not-returned-staff-secret', name: '测试员工' } });
  const active = await prisma.user.create({ data: { openid: 'private-openid', miniOpenid: 'private-mini-openid', loginName: 'private-login', passwordHash: 'private-password-hash', nickname: '统计用户', createdAt: oldDate } });
  activeId = active.id;
  emptyId = (await prisma.user.create({ data: { openid: 'empty', nickname: '新注册用户', createdAt: now } })).id;
  inactiveId = (await prisma.user.create({ data: { openid: 'inactive', nickname: '近期未录入用户', createdAt: oldDate } })).id;
  deactivatedId = (await prisma.user.create({ data: { openid: 'deactivated', nickname: '已注销', deactivatedAt: now } })).id;
  await prisma.user.create({ data: { openid: 'old-empty', nickname: '老注册无记录', createdAt: oldDate } });
  await prisma.glucoseRecord.createMany({ data: [
    { userId: activeId, valueMmol: 6.1, period: 'fasting', measuredAt: oldDate, createdAt: new Date(start7.getTime() - 1) },
    { userId: activeId, valueMmol: 8.2, period: 'post_meal_1h', measuredAt: oldDate, createdAt: start7 },
    { userId: inactiveId, valueMmol: 5.8, period: 'fasting', measuredAt: oldDate, createdAt: oldDate },
    { userId: deactivatedId, valueMmol: 6.8, period: 'fasting', measuredAt: now, createdAt: now }
  ] });
  const deleted = await prisma.glucoseRecord.create({ data: { userId: activeId, valueMmol: 20, period: 'fasting', measuredAt: now, createdAt: now, deletedAt: now } });
  deletedId = deleted.id;
  await prisma.bpRecord.create({ data: { userId: activeId, sbp: 128, dbp: 76, pulse: 72, period: 'morning', measuredAt: oldDate, createdAt: now } });
  await prisma.lipidRecord.create({ data: { userId: activeId, tc: 4.6, tg: 1.2, ldl: 2.5, hdl: 1.4, measuredAt: oldDate, createdAt: now } });
  await prisma.uricRecord.create({ data: { userId: activeId, value: 350, measuredAt: oldDate, createdAt: now } });
  adminToken = app.jwt.sign({ aud: 'admin', adminId: admin.id, ver: 0 });
  appToken = app.jwt.sign({ aud: 'app', userId: activeId, ver: 0 });
  pharmacyToken = app.jwt.sign({ aud: 'pharmacy', staffId: staff.id, pharmacyId: pharmacy.id, role: 'staff', ver: 0 });
});

afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

describe('administrator users and records', () => {
  test('rejects anonymous, app, and pharmacy sessions for every user endpoint', async () => {
    for (const forbiddenToken of ['', appToken, pharmacyToken]) {
      const headers = forbiddenToken ? { Authorization: `Bearer ${forbiddenToken}` } : {};
      const status = forbiddenToken ? 403 : 401;
      await request(app.server).get('/api/admin/users').set(headers).expect(status);
      await request(app.server).get(`/api/admin/users/${activeId}/records`).set(headers).expect(status);
      await request(app.server).patch(`/api/admin/users/${activeId}/note`).set(headers).send({ adminNote: '无权修改' }).expect(status);
      await request(app.server).patch(`/api/admin/users/${activeId}/note?redirect=/auth/login`).set(headers).send({ adminNote: '不能绕过认证' }).expect(status);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: activeId } })).adminNote).toBe('');
  });

  test('includes unbound users, counts entry times at Shanghai day boundaries, and excludes deleted data', async () => {
    const response = await request(app.server).get('/api/admin/users?limit=20').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.total).toBe(4);
    const user = response.body.items.find((item: any) => item.id === activeId);
    expect(user).toMatchObject({ nickname: '统计用户', totalRecords: 5, records7d: 4, records30d: 5, lastRecordedAt: now.toISOString() });
    expect(response.body.items.some((item: any) => item.id === emptyId)).toBe(true);
    expect(response.body.items.some((item: any) => item.id === deactivatedId)).toBe(false);
    expect(response.body.period.from7).toBe(start7.toISOString());
    for (const forbidden of ['openid', 'miniOpenid', 'unionid', 'loginName', 'passwordHash', 'avatarUrl']) expect(user).not.toHaveProperty(forbidden);
    expect(JSON.stringify(response.body)).not.toContain('private-');
  });

  test('defines registration and inactivity filters using current effective records', async () => {
    const getIds = async (activity: string) => (await request(app.server).get(`/api/admin/users?activity=${activity}&days=7`).set('Authorization', `Bearer ${adminToken}`).expect(200)).body.items.map((item: any) => item.id);
    expect(await getIds('new_without_records')).toEqual([emptyId]);
    expect(await getIds('inactive')).toEqual([inactiveId]);
    expect(new Set(await getIds('with_records'))).toEqual(new Set([activeId, inactiveId]));
    // Deleted-only records do not make a user appear active.
    await prisma.glucoseRecord.create({ data: { userId: emptyId, valueMmol: 7, period: 'fasting', measuredAt: now, createdAt: now, deletedAt: now } });
    expect(await getIds('new_without_records')).toEqual([emptyId]);
  });

  test('paginates users with stable ordering and treats search input literally', async () => {
    const first = await request(app.server).get('/api/admin/users?limit=2&page=1').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const second = await request(app.server).get('/api/admin/users?limit=2&page=2').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(new Set([...first.body.items, ...second.body.items].map((user: any) => user.id)).size).toBe(4);
    const literal = await request(app.server).get('/api/admin/users').query({ q: "%' OR 1=1 --" }).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(literal.body.total).toBe(0);
  });

  test('returns all four metrics with separate measurement and entry times and no deleted values', async () => {
    const response = await request(app.server).get(`/api/admin/users/${activeId}/records`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.total).toBe(5);
    expect(response.body.items.some((item: any) => item.id === deletedId)).toBe(false);
    expect(new Set(response.body.items.map((item: any) => item.metric))).toEqual(new Set(['glucose', 'bp', 'lipid', 'uric']));
    expect(response.body.items.find((item: any) => item.metric === 'bp')).toMatchObject({ sbp: 128, dbp: 76, pulse: 72, measuredAt: oldDate.toISOString(), createdAt: now.toISOString() });
    expect(response.body.items.find((item: any) => item.metric === 'lipid')).toMatchObject({ tc: 4.6, tg: 1.2, ldl: 2.5, hdl: 1.4 });
    expect(response.body.items.find((item: any) => item.metric === 'uric')).toMatchObject({ value: 350 });
    expect(response.body.items.find((item: any) => item.period === 'post_meal_1h')).toMatchObject({ valueMmol: 8.2, periodName: '餐后1小时' });
    for (const forbidden of ['openid', 'miniOpenid', 'unionid', 'loginName', 'passwordHash']) expect(response.body.user).not.toHaveProperty(forbidden);
    const filtered = await request(app.server).get(`/api/admin/users/${activeId}/records?metric=glucose&limit=1&page=2`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].valueMmol).toBe(6.1);
  });

  test('changes only administrator notes and supports searching them', async () => {
    await request(app.server).patch(`/api/admin/users/${activeId}/note`).set('Authorization', `Bearer ${adminToken}`).send({ adminNote: '  爸爸  ' }).expect(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: activeId } });
    expect(stored.adminNote).toBe('爸爸');
    expect(stored.nickname).toBe('统计用户');
    const searched = await request(app.server).get('/api/admin/users').query({ q: '爸爸' }).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(searched.body.items.map((item: any) => item.id)).toEqual([activeId]);
    await request(app.server).patch(`/api/admin/users/${activeId}/note`).set('Authorization', `Bearer ${adminToken}`).send({ adminNote: '备注', nickname: '不能改名' }).expect(422);
    await request(app.server).patch(`/api/admin/users/${activeId}/note`).set('Authorization', `Bearer ${adminToken}`).send({ adminNote: '长'.repeat(101) }).expect(422);
  });

  test('hides deactivated accounts and validates pagination and metrics', async () => {
    await request(app.server).get(`/api/admin/users/${deactivatedId}/records`).set('Authorization', `Bearer ${adminToken}`).expect(404);
    await request(app.server).patch(`/api/admin/users/${deactivatedId}/note`).set('Authorization', `Bearer ${adminToken}`).send({ adminNote: '不应写入' }).expect(404);
    for (const suffix of ['limit=0', 'limit=51', 'days=9', 'page=-1']) await request(app.server).get(`/api/admin/users?${suffix}`).set('Authorization', `Bearer ${adminToken}`).expect(422);
    await request(app.server).get(`/api/admin/users/${activeId}/records?metric=unknown`).set('Authorization', `Bearer ${adminToken}`).expect(422);
  });

  test('uses calendar-day windows independent of host timezone', async () => {
    const date = new Date('2026-09-05T00:20:00+08:00');
    expect(adminWindow(7, date).from.toISOString()).toBe('2026-08-29T16:00:00.000Z');
    const result = await listAdminUsers(prisma, { q: '', activity: 'all', days: 7, page: 1, limit: 20 }, now);
    expect(result.period.from7).toBe(start7.toISOString());
    expect(result.items.find((user) => user.id === activeId)?.records7d).toBe(4);
  });
});
