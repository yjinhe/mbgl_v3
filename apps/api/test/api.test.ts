import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/services/password.js';
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
  execFileSync('pnpm', ['--filter', '@tangji/api', 'prisma:generate'], { stdio: 'pipe' });
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

describe('app records', () => {
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
    await request(app.server)
      .post('/api/app/records/glucose')
      .set('Authorization', `Bearer ${appToken}`)
      .send({ value: 3.5, unit: 'mmol', period: 'fasting', measuredAt: new Date().toISOString() })
      .expect(201)
      .expect((res) => expect(res.body.safetyAlert).toBe('low'));

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
    await request(app.server).delete(`/api/app/records/glucose/${id}`).set('Authorization', `Bearer ${appToken}`).expect(204);
    const recycle = await request(app.server).get('/api/app/records/recycle-bin').set('Authorization', `Bearer ${appToken}`).expect(200);
    expect(recycle.body.items.some((item: any) => item.id === id)).toBe(true);
    await request(app.server).post(`/api/app/records/glucose/${id}/restore`).set('Authorization', `Bearer ${appToken}`).expect(200);
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
    await request(app.server).post('/api/app/pharmacy/bind').set('Authorization', `Bearer ${appToken}`).send({ code: 'ABCD2345' }).expect(409);
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
      .send({ username: 'kn_new_staff', name: '新店员', password: 'Staff@123', role: 'staff' })
      .expect(200);
    expect(created.body.username).toBe('kn_new_staff');
    expect(created.body.disabledAt).toBeNull();

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
    const created = await request(app.server)
      .post('/api/admin/pharmacies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '新药房', address: '人民路', phone: '123', ownerUsername: 'new_owner', ownerPassword: 'Owner@123' })
      .expect(200);
    await request(app.server)
      .patch(`/api/admin/pharmacies/${created.body.pharmacy.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ disabledAt: new Date().toISOString() })
      .expect(200);
  });
});
