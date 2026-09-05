import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/services/password.js';
import { purgeExpiredRecords } from '../src/services/recycle.js';
import { exchangeWechatCode, WechatLoginError } from '../src/services/wechat.js';
import { createSqliteSchema } from './setup-db.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let appToken = '';
let pharmacyToken = '';
let ownerToken = '';
let otherPharmacyToken = '';
let adminToken = '';
let userId = '';
let otherUserId = '';
let pharmacyId = '';
let otherPharmacyId = '';
let staffId = '';
let otherOwnerId = '';

async function loginApp(code = 'seed') {
  const res = await request(app.server).post('/api/app/auth/wechat').send({ code }).expect(200);
  return res.body.token as string;
}

async function loginPharmacy(username: string, password: string) {
  const res = await request(app.server).post('/api/pharmacy/auth/login').send({ username, password }).expect(200);
  return res.body.token as string;
}

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tangji-api-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  process.env.JWT_SECRET = 'test-secret';
  process.env.WECHAT_MOCK = 'true';
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync(path.join(apiRoot, 'node_modules/.bin/prisma'), [
    'generate',
    '--schema',
    path.join(apiRoot, 'prisma/schema.prisma')
  ], { stdio: 'pipe' });
  prisma = new PrismaClient();
  await createSqliteSchema(prisma);
  app = await buildApp({ prisma });

  const pharmacy = await prisma.pharmacy.create({ data: { name: '康宁大药房 · 中山路店' } });
  const otherPharmacy = await prisma.pharmacy.create({ data: { name: '百姓缘药房 · 解放路店' } });
  pharmacyId = pharmacy.id;
  otherPharmacyId = otherPharmacy.id;
  const owner = await prisma.pharmacyStaff.create({
    data: { pharmacyId: pharmacy.id, username: 'kangning', passwordHash: await hashPassword('Kn@123456'), name: '王建国', role: 'owner' }
  });
  const staff = await prisma.pharmacyStaff.create({
    data: { pharmacyId: pharmacy.id, username: 'kn_li', passwordHash: await hashPassword('Kn@123456'), name: '李雯', role: 'staff' }
  });
  const otherOwner = await prisma.pharmacyStaff.create({
    data: { pharmacyId: otherPharmacy.id, username: 'baixingyuan', passwordHash: await hashPassword('Bxy@123456'), name: '赵敏', role: 'owner' }
  });
  otherOwnerId = otherOwner.id;
  staffId = staff.id;
  await prisma.adminUser.create({ data: { username: 'admin', passwordHash: await hashPassword('Admin@123456') } });
  const invite = await prisma.inviteCode.create({
    data: { pharmacyId: pharmacy.id, staffId: staff.id, code: 'KN23DEMO', expiresAt: new Date(Date.now() + 30 * 86400000) }
  });
  const user = await prisma.user.create({ data: { openid: 'seed_demo', nickname: '微信用户_8462', sex: 'male' } });
  const otherUser = await prisma.user.create({ data: { openid: 'other_demo', nickname: '他店客户', sex: 'female' } });
  userId = user.id;
  otherUserId = otherUser.id;
  await prisma.pharmacyCustomer.create({ data: { pharmacyId: pharmacy.id, userId: user.id, inviteCodeId: invite.id } });
  await prisma.pharmacyCustomer.create({ data: { pharmacyId: otherPharmacy.id, userId: otherUser.id } });
  await prisma.glucoseRecord.create({ data: { userId: user.id, valueMmol: 6.1, period: 'fasting', measuredAt: new Date(), tags: '[]', note: '' } });

  appToken = app.jwt.sign({ aud: 'app', userId: user.id });
  pharmacyToken = await loginPharmacy('kn_li', 'Kn@123456');
  ownerToken = await loginPharmacy('kangning', 'Kn@123456');
  otherPharmacyToken = await loginPharmacy('baixingyuan', 'Bxy@123456');
  adminToken = (await request(app.server).post('/api/admin/auth/login').send({ username: 'admin', password: 'Admin@123456' }).expect(200)).body.token;
  void owner;
  void otherOwner;
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

describe('app account authentication', () => {
  test('persists an explicitly selected avatar and rejects invalid image data', async () => {
    const avatarUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const updated = await request(app.server)
      .patch('/api/app/me')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ avatarUrl })
      .expect(200);
    expect(updated.body.avatarUrl).toBe(avatarUrl);

    const me = await request(app.server)
      .get('/api/app/me')
      .set('Authorization', `Bearer ${appToken}`)
      .expect(200);
    expect(me.body.avatarUrl).toBe(avatarUrl);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).avatarUrl).toBe(avatarUrl);

    await request(app.server)
      .patch('/api/app/me')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ avatarUrl: 'data:image/png;base64,bm90LWFuLWltYWdl' })
      .expect(422);

    const oversizedPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(128 * 1024)
    ]).toString('base64');
    await request(app.server)
      .patch('/api/app/me')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ avatarUrl: `data:image/png;base64,${oversizedPng}` })
      .expect(422);
  });

  test('registers a normalized local account and returns a safe session', async () => {
    const password = '1234567';
    const response = await request(app.server)
      .post('/api/app/auth/register')
      .send({ loginName: 'Health_User', nickname: '健康用户', password })
      .expect(201);

    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({ loginName: 'health_user', nickname: '健康用户', hasPassword: true });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    const me = await request(app.server).get('/api/app/me').set('Authorization', `Bearer ${response.body.token}`).expect(200);
    expect(me.body).toMatchObject({ loginName: 'health_user', hasPassword: true });

    const stored = await prisma.user.findUniqueOrThrow({ where: { loginName: 'health_user' } });
    expect(stored.openid).toBe('local:health_user');
    expect(stored.passwordHash).not.toBe(password);
  });

  test('rejects duplicate accounts and passwords shorter than seven characters', async () => {
    const duplicate = await request(app.server)
      .post('/api/app/auth/register')
      .send({ loginName: 'HEALTH_USER', nickname: '重复用户', password: 'Another@Pass123' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('ACCOUNT_EXISTS');

    await request(app.server)
      .post('/api/app/auth/register')
      .send({ loginName: 'weak_account', nickname: '短密码用户', password: '123456' })
      .expect(422);
    expect(await prisma.user.findUnique({ where: { loginName: 'weak_account' } })).toBeNull();
  });

  test('logs in without revealing whether an account exists', async () => {
    const success = await request(app.server)
      .post('/api/app/auth/login')
      .send({ loginName: 'HEALTH_USER', password: '1234567' })
      .expect(200);
    expect(success.body.user.loginName).toBe('health_user');

    const wrongPassword = await request(app.server)
      .post('/api/app/auth/login')
      .send({ loginName: 'health_user', password: 'Wrong@Pass1234' })
      .expect(403);
    const missingAccount = await request(app.server)
      .post('/api/app/auth/login')
      .send({ loginName: 'missing_user', password: 'Wrong@Pass1234' })
      .expect(403);
    expect(wrongPassword.body.error).toEqual(missingAccount.body.error);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('changes a local password and invalidates the previous session', async () => {
    const currentPassword = '1234567';
    const newPassword = '7654321';
    const registration = await request(app.server)
      .post('/api/app/auth/register')
      .send({ loginName: 'change_user', nickname: '改密用户', password: currentPassword })
      .expect(201);
    const token = registration.body.token as string;

    await request(app.server)
      .post('/api/app/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Incorrect@Pass1', newPassword })
      .expect(403);

    await request(app.server)
      .post('/api/app/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword, newPassword: '654321' })
      .expect(422);

    await request(app.server)
      .post('/api/app/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword, newPassword })
      .expect(204);

    await request(app.server).get('/api/app/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.server).post('/api/app/auth/login').send({ loginName: 'change_user', password: currentPassword }).expect(403);
    const nextSession = await request(app.server).post('/api/app/auth/login').send({ loginName: 'change_user', password: newPassword }).expect(200);
    await request(app.server).get('/api/app/me').set('Authorization', `Bearer ${nextSession.body.token}`).expect(200);
  });

  test('rejects password login for a deactivated account', async () => {
    await prisma.user.create({
      data: {
        openid: 'local:closed_user',
        loginName: 'closed_user',
        passwordHash: await hashPassword('Closed@Pass123'),
        nickname: '已注销用户',
        deactivatedAt: new Date()
      }
    });
    const response = await request(app.server)
      .post('/api/app/auth/login')
      .send({ loginName: 'closed_user', password: 'Closed@Pass123' })
      .expect(403);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('app records', () => {
  test('reports a versioned, non-cacheable health response', async () => {
    const response = await request(app.server).get('/health').expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.body).toEqual({ ok: true, version: expect.any(String), buildSha: expect.any(String) });
    expect(response.body.version.length).toBeGreaterThan(0);
    expect(response.body.buildSha.length).toBeGreaterThan(0);
  });

  test('maps malformed input to a validation response', async () => {
    const response = await request(app.server).post('/api/pharmacy/auth/login').send({}).expect(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.message).toBe('请求参数不正确');
  });

  test('rejects missing token and invalid glucose without inserting', async () => {
    await request(app.server).get('/api/app/me').expect(401);
    const before = await prisma.glucoseRecord.count({ where: { userId } });
    await request(app.server)
      .post('/api/app/records/glucose')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ value: 1.0, unit: 'mmol', measuredAt: new Date().toISOString() })
      .expect(422);
    expect(await prisma.glucoseRecord.count({ where: { userId } })).toBe(before);
  });

  test('creates four metric records with correct safety alerts', async () => {
    const glucose = await request(app.server)
      .post('/api/app/records/glucose')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ value: 3.5, unit: 'mmol', period: 'post_meal_1h', measuredAt: new Date().toISOString() })
      .expect(201);
    expect(glucose.body.safetyAlert).toBe('low');
    expect(glucose.body.record.period).toBe('post_meal_1h');
    expect(glucose.body.record.periodName).toBe('餐后1小时');

    const bp = await request(app.server)
      .post('/api/app/records/bp')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ sbp: 186, dbp: 112, period: 'morning', measuredAt: new Date().toISOString() })
      .expect(201);
    expect(bp.body.safetyAlert).toBe('high');

    const lipid = await request(app.server)
      .post('/api/app/records/lipid')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ tc: 5.4, fasting: true, measuredAt: new Date().toISOString() })
      .expect(201);
    expect(lipid.body.safetyAlert).toBeNull();

    const uric = await request(app.server)
      .post('/api/app/records/uric')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ value: 560, fasting: true, measuredAt: new Date().toISOString() })
      .expect(201);
    expect(uric.body.safetyAlert).toBe('high');
  });

  test('soft deletes and restores records', async () => {
    const created = await request(app.server)
      .post('/api/app/records/glucose')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ value: 7.8, unit: 'mmol', period: 'after_lunch', measuredAt: new Date().toISOString() })
      .expect(201);
    const id = created.body.record.id;
    expect(created.body.record.displayUnit).toBe('mmol/L');
    await request(app.server).delete(`/api/app/records/glucose/${id}`).set('Authorization', `Bearer ${appToken}`).expect(204);
    const recycle = await request(app.server).get('/api/app/records/recycle-bin').set('Authorization', `Bearer ${appToken}`).expect(200);
    expect(recycle.body.items.some((item: any) => item.id === id)).toBe(true);
    await request(app.server).post(`/api/app/records/glucose/${id}/restore`).set('Authorization', `Bearer ${appToken}`).expect(200);
  });

  test('permanently deletes only records already in the recycle bin', async () => {
    const created = await request(app.server)
      .post('/api/app/records/bp')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ sbp: 128, dbp: 78, period: 'morning', measuredAt: new Date().toISOString() })
      .expect(201);
    const id = created.body.record.id;
    await request(app.server).delete(`/api/app/records/bp/${id}/permanent`).set('Authorization', `Bearer ${appToken}`).expect(404);
    await request(app.server).delete(`/api/app/records/bp/${id}`).set('Authorization', `Bearer ${appToken}`).expect(204);
    await request(app.server).delete(`/api/app/records/bp/${id}/permanent`).set('Authorization', `Bearer ${appToken}`).expect(204);
    expect(await prisma.bpRecord.findUnique({ where: { id } })).toBeNull();
  });

  test('hides expired recycle records and purges them permanently', async () => {
    const visible = await prisma.bpRecord.create({
      data: {
        userId,
        sbp: 130,
        dbp: 82,
        period: 'morning',
        measuredAt: new Date(Date.now() - 3 * 86400000),
        deletedAt: new Date(Date.now() - 2 * 86400000),
        tags: '[]',
        note: ''
      }
    });
    const expired = await prisma.uricRecord.create({
      data: {
        userId,
        value: 420,
        fasting: true,
        measuredAt: new Date(Date.now() - 10 * 86400000),
        deletedAt: new Date(Date.now() - 8 * 86400000),
        note: ''
      }
    });
    const recycle = await request(app.server).get('/api/app/records/recycle-bin').set('Authorization', `Bearer ${appToken}`).expect(200);
    expect(recycle.body.items.find((item: any) => item.id === visible.id)?.daysLeft).toBe(5);
    expect(recycle.body.items.some((item: any) => item.id === expired.id)).toBe(false);
    await request(app.server).post(`/api/app/records/uric/${expired.id}/restore`).set('Authorization', `Bearer ${appToken}`).expect(404);
    expect((await purgeExpiredRecords(prisma)).deletedRecords).toBeGreaterThanOrEqual(1);
    expect(await prisma.uricRecord.findUnique({ where: { id: expired.id } })).toBeNull();
  });

  test('paginates record history with a stable cursor', async () => {
    for (const value of [401, 402, 403]) {
      await prisma.uricRecord.create({ data: { userId, value, fasting: true, measuredAt: new Date(Date.now() - 10 * 86400000 + value), note: '' } });
    }
    const first = await request(app.server).get('/api/app/records/uric?limit=2').set('Authorization', `Bearer ${appToken}`).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app.server)
      .get(`/api/app/records/uric?limit=2&cursor=${first.body.nextCursor}`)
      .set('Authorization', `Bearer ${appToken}`)
      .expect(200);
    const firstIds = new Set(first.body.items.map((item: any) => item.id));
    expect(second.body.items.every((item: any) => !firstIds.has(item.id))).toBe(true);
  });

  test('applies the requested range to lipid statistics', async () => {
    const old = await prisma.lipidRecord.create({
      data: { userId, tc: 6.2, fasting: true, measuredAt: new Date(Date.now() - 30 * 86400000), note: '' }
    });
    const recent = await prisma.lipidRecord.create({
      data: { userId, tc: 4.8, fasting: true, measuredAt: new Date(), note: '' }
    });
    const response = await request(app.server).get('/api/app/stats?metric=lipid&range=7').set('Authorization', `Bearer ${appToken}`).expect(200);
    expect(response.body.series.some((item: any) => item.id === recent.id)).toBe(true);
    expect(response.body.series.some((item: any) => item.id === old.id)).toBe(false);
  });

  test('builds weekly report from metrics recorded in the last 7 days', async () => {
    await request(app.server)
      .post('/api/app/records/bp')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ sbp: 128, dbp: 82, pulse: 72, period: 'morning', measuredAt: new Date().toISOString() })
      .expect(201);
    await request(app.server)
      .post('/api/app/records/lipid')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ tc: 4.9, tg: 1.4, ldl: 2.8, hdl: 1.2, measuredAt: new Date().toISOString() })
      .expect(201);
    await request(app.server)
      .post('/api/app/records/uric')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ value: 390, measuredAt: new Date().toISOString() })
      .expect(201);

    const report = await request(app.server).get('/api/app/report/weekly').set('Authorization', `Bearer ${appToken}`).expect(200);
    expect(report.body.title).toBe('近 7 天健康报告');
    expect(report.body.rangeDays).toBe(7);
    expect(report.body.sections.glucose.n).toBeGreaterThan(0);
    expect(report.body.sections.bp.avgSbp).toBeGreaterThan(0);
    expect(report.body.sections.lipid.latest.tc).toBe(4.9);
    expect(report.body.sections.uric.latest.value).toBe(390);
  });

  test('exports a single metric as csv and all metrics as zip', async () => {
    await request(app.server)
      .post('/api/app/records/bp')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ sbp: 132, dbp: 84, pulse: 70, period: 'morning', measuredAt: new Date().toISOString(), note: '导出测试' })
      .expect(201);

    const csv = await request(app.server)
      .get('/api/app/export/csv?metric=bp')
      .set('Authorization', `Bearer ${appToken}`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('日期,时间,收缩压(mmHg),舒张压(mmHg),脉搏,时段,状态,备注');
    expect(csv.text).toContain('132,84,70');
    expect(csv.text).toContain('导出测试');

    const zip = await request(app.server)
      .get('/api/app/export/csv?metric=all')
      .set('Authorization', `Bearer ${appToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(zip.headers['content-type']).toContain('application/zip');
    expect(Buffer.isBuffer(zip.body)).toBe(true);
    expect(zip.body.subarray(0, 2).toString('utf8')).toBe('PK');
  });
});

describe('binding and alerts', () => {
  test('previews, binds, lists, unbinds and then denies pharmacy detail access', async () => {
    const token = await loginApp('new_bind_user');
    await request(app.server).get('/api/app/pharmacy/invite/KN23DEMO').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.server).post('/api/app/pharmacy/bind').set('Authorization', `Bearer ${token}`).send({ code: 'KN23DEMO' }).expect(200);
    const customers = await request(app.server).get('/api/pharmacy/customers').set('Authorization', `Bearer ${pharmacyToken}`).expect(200);
    const bound = customers.body.items.find((item: any) => item.nickname === '微信用户');
    expect(bound).toBeTruthy();
    await request(app.server).delete('/api/app/pharmacy/bind').set('Authorization', `Bearer ${token}`).expect(204);
    await request(app.server).get(`/api/pharmacy/customers/${bound.userId}`).set('Authorization', `Bearer ${pharmacyToken}`).expect(403);
  });

  test('shows pending alert and marks follow-up idempotently', async () => {
    const alerts = await request(app.server).get('/api/pharmacy/alerts?days=7&status=pending').set('Authorization', `Bearer ${pharmacyToken}`).expect(200);
    const bp = alerts.body.items.find((item: any) => item.metric === 'bp');
    expect(bp).toBeTruthy();
    await request(app.server)
      .post('/api/pharmacy/alerts/follow-up')
      .set('Authorization', `Bearer ${pharmacyToken}`)
      .send({ metric: 'bp', recordId: bp.record.id, note: '已电话提醒复测' })
      .expect(200);
    await request(app.server)
      .post('/api/pharmacy/alerts/follow-up')
      .set('Authorization', `Bearer ${pharmacyToken}`)
      .send({ metric: 'bp', recordId: bp.record.id, note: '重复' })
      .expect(200);
  });

  test('database allows only one active pharmacy binding per user', async () => {
    const user = await prisma.user.create({ data: { openid: 'binding_constraint_user' } });
    await prisma.pharmacyCustomer.create({ data: { pharmacyId, userId: user.id } });

    await expect(
      prisma.pharmacyCustomer.create({ data: { pharmacyId: otherPharmacyId, userId: user.id } })
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.pharmacyCustomer.count({ where: { userId: user.id, unboundAt: null } })).toBe(1);
  });
});

describe('permission matrix', () => {
  test('① pharmacy A cannot read pharmacy B customer', async () => {
    await request(app.server).get(`/api/pharmacy/customers/${otherUserId}`).set('Authorization', `Bearer ${pharmacyToken}`).expect(403);
  });

  test('② unbound customer becomes forbidden', async () => {
    await prisma.pharmacyCustomer.updateMany({ where: { pharmacyId, userId }, data: { unboundAt: new Date() } });
    await request(app.server).get(`/api/pharmacy/customers/${userId}`).set('Authorization', `Bearer ${pharmacyToken}`).expect(403);
    await prisma.pharmacyCustomer.updateMany({ where: { pharmacyId, userId }, data: { unboundAt: null } });
  });

  test('③ app token cannot call pharmacy routes', async () => {
    await request(app.server).get('/api/pharmacy/customers').set('Authorization', `Bearer ${appToken}`).expect(403);
  });

  test('④ staff cannot call staff management', async () => {
    await request(app.server).get('/api/pharmacy/staff').set('Authorization', `Bearer ${pharmacyToken}`).expect(403);
    await request(app.server)
      .post('/api/pharmacy/staff')
      .set('Authorization', `Bearer ${pharmacyToken}`)
      .send({ username: 'forbidden_staff', name: '越权员工', password: 'Password@123' })
      .expect(403);
    expect(await prisma.pharmacyStaff.count({ where: { username: 'forbidden_staff' } })).toBe(0);
    const before = await prisma.pharmacy.findUniqueOrThrow({ where: { id: pharmacyId } });
    await request(app.server)
      .patch('/api/pharmacy/profile')
      .set('Authorization', `Bearer ${pharmacyToken}`)
      .send({ name: '越权修改' })
      .expect(403);
    expect((await prisma.pharmacy.findUniqueOrThrow({ where: { id: pharmacyId } })).name).toBe(before.name);
  });

  test('owner cannot modify staff from another pharmacy', async () => {
    await request(app.server)
      .patch(`/api/pharmacy/staff/${otherOwnerId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ disabledAt: new Date().toISOString() })
      .expect(404);
    expect((await prisma.pharmacyStaff.findUniqueOrThrow({ where: { id: otherOwnerId } })).disabledAt).toBeNull();
  });

  test('⑤ admin cannot call customer health data endpoint', async () => {
    await request(app.server).get(`/api/pharmacy/customers/${userId}`).set('Authorization', `Bearer ${adminToken}`).expect(403);
  });

  test('⑥ disabled pharmacy rejects staff requests', async () => {
    await prisma.pharmacy.update({ where: { id: pharmacyId }, data: { disabledAt: new Date() } });
    await request(app.server).get('/api/pharmacy/customers').set('Authorization', `Bearer ${pharmacyToken}`).expect(403);
    await prisma.pharmacy.update({ where: { id: pharmacyId }, data: { disabledAt: null } });
  });

  test('⑦ invalid or expired invite preview returns 404', async () => {
    await request(app.server).get('/api/app/pharmacy/invite/NOPEDEMO').set('Authorization', `Bearer ${appToken}`).expect(404);
  });

  test('⑧ already bound user cannot bind another pharmacy', async () => {
    const otherInvite = await prisma.inviteCode.create({
      data: { pharmacyId: otherPharmacyId, staffId, code: 'ABCD2345', expiresAt: new Date(Date.now() + 86400000) }
    });
    void otherInvite;
    const response = await request(app.server)
      .post('/api/app/pharmacy/bind')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ code: 'ABCD2345' })
      .expect(409);
    expect(response.body.error.code).toBe('BINDING_EXISTS');
  });
});

describe('password changes', () => {
  test('pharmacy staff can change password and immediately invalidates the old token', async () => {
    const username = 'password_change_staff';
    const currentPassword = 'OldStaff@1234';
    const newPassword = 'NewStaff@5678';
    await prisma.pharmacyStaff.create({
      data: {
        pharmacyId,
        username,
        passwordHash: await hashPassword(currentPassword),
        name: '改密测试店员',
        role: 'staff'
      }
    });
    const token = await loginPharmacy(username, currentPassword);

    const rejected = await request(app.server)
      .post('/api/pharmacy/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongStaff@1234', newPassword })
      .expect(403);
    expect(rejected.body.error.code).toBe('FORBIDDEN');

    await request(app.server)
      .post('/api/pharmacy/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword, newPassword })
      .expect(204);

    await request(app.server).get('/api/pharmacy/profile').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app.server).post('/api/pharmacy/auth/login').send({ username, password: currentPassword }).expect(403);
    const newToken = await loginPharmacy(username, newPassword);
    await request(app.server).get('/api/pharmacy/profile').set('Authorization', `Bearer ${newToken}`).expect(200);
  });

  test('admin can change password and immediately invalidates the old token', async () => {
    const username = 'password_change_admin';
    const currentPassword = 'OldAdmin@1234';
    const newPassword = 'NewAdmin@5678';
    await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(currentPassword) } });
    const login = await request(app.server).post('/api/admin/auth/login').send({ username, password: currentPassword }).expect(200);
    const token = login.body.token as string;

    const rejected = await request(app.server)
      .post('/api/admin/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongAdmin@1234', newPassword })
      .expect(403);
    expect(rejected.body.error.code).toBe('FORBIDDEN');

    await request(app.server)
      .post('/api/admin/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword, newPassword })
      .expect(204);

    await request(app.server).get('/api/admin/stats').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app.server).post('/api/admin/auth/login').send({ username, password: currentPassword }).expect(403);
    const newLogin = await request(app.server).post('/api/admin/auth/login').send({ username, password: newPassword }).expect(200);
    await request(app.server).get('/api/admin/stats').set('Authorization', `Bearer ${newLogin.body.token}`).expect(200);
  });
});

describe('account deactivation', () => {
  test('deletes health data, revokes pharmacy access, and invalidates existing sessions', async () => {
    const user = await prisma.user.create({
      data: {
        openid: 'mock_deactivate-user',
        miniOpenid: 'mock_deactivate-user',
        unionid: 'mock:deactivate-user',
        nickname: '注销测试用户'
      }
    });
    const glucose = await prisma.glucoseRecord.create({
      data: { userId: user.id, valueMmol: 6.8, period: 'fasting', measuredAt: new Date(), tags: '[]', note: '' }
    });
    await prisma.bpRecord.create({ data: { userId: user.id, sbp: 128, dbp: 82, period: 'morning', measuredAt: new Date(), tags: '[]', note: '' } });
    await prisma.lipidRecord.create({ data: { userId: user.id, tc: 4.9, fasting: true, measuredAt: new Date(), note: '' } });
    await prisma.uricRecord.create({ data: { userId: user.id, value: 380, fasting: true, measuredAt: new Date(), note: '' } });
    await prisma.dailySummary.create({ data: { userId: user.id, date: '2026-07-12', avg: 6.8, max: 6.8, min: 6.8, count: 1, okCount: 1 } });
    await prisma.pharmacyCustomer.create({ data: { pharmacyId, userId: user.id } });
    await prisma.followUp.create({ data: { pharmacyId, staffId, metric: 'glucose', recordId: glucose.id, note: '待跟进' } });
    await prisma.pharmacyAccessLog.create({ data: { pharmacyId, staffId, userId: user.id, action: 'view_customer' } });
    const token = app.jwt.sign({ aud: 'app', userId: user.id });

    await request(app.server).delete('/api/app/me').set('Authorization', `Bearer ${token}`).expect(204);

    await request(app.server).get('/api/app/me').set('Authorization', `Bearer ${token}`).expect(401);
    const relogin = await request(app.server).post('/api/app/auth/wechat').send({ code: 'deactivate-user' }).expect(403);
    expect(relogin.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    expect(await prisma.glucoseRecord.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.bpRecord.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.lipidRecord.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.uricRecord.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.dailySummary.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.followUp.count({ where: { recordId: glucose.id } })).toBe(0);
    expect(await prisma.pharmacyAccessLog.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.pharmacyCustomer.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deactivatedAt).toBeTruthy();

    const staleBinding = await prisma.pharmacyCustomer.create({ data: { pharmacyId, userId: user.id } });
    await request(app.server).get(`/api/pharmacy/customers/${user.id}`).set('Authorization', `Bearer ${pharmacyToken}`).expect(403);
    await prisma.pharmacyCustomer.delete({ where: { id: staleBinding.id } });
  });
});

describe('invites and admin', () => {
  test('generates invite code without ambiguous characters', async () => {
    const res = await request(app.server).post('/api/pharmacy/invites').set('Authorization', `Bearer ${pharmacyToken}`).expect(200);
    expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(res.body.qrContent).toContain(res.body.code);
  });

  test('owner can create, disable and enable pharmacy staff', async () => {
    const created = await request(app.server)
      .post('/api/pharmacy/staff')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ username: 'kn_new_staff', name: '新店员', password: 'Staff@123456', role: 'staff' })
      .expect(200);
    expect(created.body.username).toBe('kn_new_staff');
    expect(created.body.disabledAt).toBeNull();
    expect(created.body.passwordHash).toBeUndefined();

    const disabledAt = new Date().toISOString();
    const disabled = await request(app.server)
      .patch(`/api/pharmacy/staff/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ disabledAt })
      .expect(200);
    expect(disabled.body.disabledAt).toBeTruthy();

    const enabled = await request(app.server)
      .patch(`/api/pharmacy/staff/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ disabledAt: null })
      .expect(200);
    expect(enabled.body.disabledAt).toBeNull();
  });

  test('owner can list staff and admin can create/disable pharmacies', async () => {
    const staff = await request(app.server).get('/api/pharmacy/staff').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(staff.body.items.length).toBeGreaterThan(0);
    expect(staff.body.items.every((item: any) => item.passwordHash === undefined)).toBe(true);
    const created = await request(app.server)
      .post('/api/admin/pharmacies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '新药房', address: '人民路', phone: '123', ownerUsername: 'new_owner', ownerPassword: 'Owner@123456' })
      .expect(200);
    await request(app.server)
      .patch(`/api/admin/pharmacies/${created.body.pharmacy.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ disabledAt: new Date().toISOString() })
      .expect(200);
  });
});

describe('wechat code exchange', () => {
  test('returns web oauth config and exchanges a mock web code for a stable session', async () => {
    const webConfig = await request(app.server).get('/api/app/auth/wechat-web/config').expect(200);
    expect(webConfig.body).toEqual({
      enabled: expect.any(Boolean),
      appId: expect.any(String),
      redirectUri: expect.any(String)
    });
    expect(webConfig.body.enabled).toBe(Boolean(webConfig.body.appId));

    const first = await request(app.server).post('/api/app/auth/wechat-web').send({ code: 'web-login-code' }).expect(200);
    expect(first.body.token).toEqual(expect.any(String));
    expect(first.body.user).not.toHaveProperty('openid');
    expect(first.body.user).not.toHaveProperty('unionid');
    await request(app.server).get('/api/app/me').set('Authorization', `Bearer ${first.body.token}`).expect(200);

    const second = await request(app.server).post('/api/app/auth/wechat-web').send({ code: 'web-login-code' }).expect(200);
    expect(second.body.user.id).toBe(first.body.user.id);

    const mini = await request(app.server).post('/api/app/auth/wechat').send({ code: 'web-login-code' }).expect(200);
    expect(mini.body.user.id).toBe(first.body.user.id);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: first.body.user.id } });
    expect(stored.miniOpenid).toBe('mock_web-login-code');
    expect(stored.webOpenid).toBe('mock_web-login-code');
    expect(stored.unionid).toBe('mock:web-login-code');
  });

  test('exchanges a login code for a stable openid', async () => {
    const fetchMock = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('appid')).toBe('wx-test');
      expect(url.searchParams.get('secret')).toBe('secret-test');
      expect(url.searchParams.get('js_code')).toBe('login-code');
      return new Response(JSON.stringify({ openid: 'openid-stable', unionid: 'unionid-stable', session_key: 'session-key' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;
    await expect(exchangeWechatCode('login-code', 'wx-test', 'secret-test', fetchMock)).resolves.toEqual({
      openid: 'openid-stable',
      unionid: 'unionid-stable'
    });
  });

  test('rejects a wechat API error response', async () => {
    const fetchMock = (async () => new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as typeof fetch;
    await expect(exchangeWechatCode('bad-code', 'wx-test', 'secret-test', fetchMock)).rejects.toBeInstanceOf(WechatLoginError);
  });
});
