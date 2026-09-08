import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { addDaysToKey, localDayKey } from '@tangji/shared';
import { buildApp } from '../src/app.js';
import { normalizeTimes, weeklyMedicationSection } from '../src/services/medications.js';
import {
  buildMedicationMessage,
  medicationNamesField,
  runReminderTick,
  slotsInWindow,
  type ReminderConfig,
  type ReminderTickDeps
} from '../src/services/reminders.js';
import { resetWechatTokenCache } from '../src/services/wechat-token.js';
import { createSqliteSchema } from './setup-db.js';

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tangji-medications-'));
  prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(dir, 'test.db')}` } } });
  await createSqliteSchema(prisma);
  app = await buildApp({ prisma });
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetWechatTokenCache();
});

async function account(name: string, data: { miniOpenid?: string | null } = {}) {
  const user = await prisma.user.create({ data: { openid: name, miniOpenid: data.miniOpenid === undefined ? `mini_${name}` : data.miniOpenid } });
  return { user, headers: { authorization: `Bearer ${app.jwt.sign({ aud: 'app', userId: user.id })}` } };
}

/** Inserts a medication directly; `times` must already be normalized. */
function seedMedication(userId: string, name: string, times: string[], extra: { createdAt?: Date; archivedAt?: Date } = {}) {
  return prisma.medication.create({ data: { userId, name, times: JSON.stringify(times), ...extra } });
}

function seedPlan(userId: string, quota: number, enabled = true) {
  return prisma.reminderPlan.create({ data: { userId, metric: 'medication', enabled, time: '00:00', period: null, quota } });
}

function seedLog(userId: string, medicationId: string, day: string, slot: string) {
  return prisma.medicationLog.create({ data: { userId, medicationId, day, slot } });
}

const reminderConfig: ReminderConfig = {
  wechatAppId: 'wx-test-appid',
  wechatSecret: 'wx-test-secret',
  miniprogramState: 'trial',
  reminderTemplates: {
    glucose: { id: 'tmpl-glucose', fields: ['time1', 'thing2', 'thing3'] },
    bp: { id: 'tmpl-bp', fields: ['time1', 'thing2'] },
    medication: { id: 'tmpl-medication', fields: ['time1', 'thing2', 'thing3'] }
  }
};

interface SentMessage {
  url: string;
  body: any;
}

function fakeWechat(respond: (message: any) => unknown = () => ({ errcode: 0, errmsg: 'ok' }), token: unknown = { access_token: 'token-1', expires_in: 7200 }) {
  const sent: SentMessage[] = [];
  let tokenRequests = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://api.weixin.qq.com/cgi-bin/token?')) {
      tokenRequests += 1;
      return json(token);
    }
    if (url.startsWith('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=')) {
      const body = JSON.parse(String(init?.body));
      sent.push({ url, body });
      return json(respond(body));
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { fetchImpl, sent, tokenRequests: () => tokenRequests };
}

const silentLog = { info() {}, warn() {}, error() {} };

function tick(now: Date, fetchImpl: typeof fetch, overrides: Partial<ReminderTickDeps> = {}) {
  return runReminderTick(prisma, { now, fetch: fetchImpl, config: reminderConfig, log: silentLog, ...overrides });
}

// Asia/Shanghai wall clock; tick tests use disjoint hours so their 10-minute windows never overlap.
const shanghai = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`);
const DAY = '2026-09-09';

const medicationTemplateKey = 'medication_reminder';

describe('medication helpers', () => {
  test('normalizeTimes validates, deduplicates and sorts', () => {
    expect(normalizeTimes(['20:00', '08:00', '08:00'])).toEqual(['08:00', '20:00']);
    expect(normalizeTimes(['08:00'])).toEqual(['08:00']);
    expect(normalizeTimes([])).toBeNull();
    expect(normalizeTimes(['01:00', '02:00', '03:00', '04:00', '05:00'])).toBeNull();
    expect(normalizeTimes(['8:00'])).toBeNull();
    expect(normalizeTimes(['24:00'])).toBeNull();
    expect(normalizeTimes(['08:60'])).toBeNull();
  });

  test('medicationNamesField joins with 、 and truncates to 20 characters ending with 等', () => {
    expect(medicationNamesField(['二甲双胍'])).toBe('二甲双胍');
    expect(medicationNamesField(['二甲双胍', '阿卡波糖'])).toBe('二甲双胍、阿卡波糖');
    expect(medicationNamesField(['一二三四五六七八九十', '一二三四五六七八九'])).toBe('一二三四五六七八九十、一二三四五六七八九');
    const cut = medicationNamesField(['一二三四五六七八九十', '一二三四五六七八九十', '甲']);
    expect(cut).toBe('一二三四五六七八九十、一二三四五六七八等');
    expect(Array.from(cut)).toHaveLength(20);
    // A cut that lands on a separator drops it rather than producing '、等'.
    const separator = medicationNamesField(['一二三四五六七八九十', '一二三四五六七', '甲乙']);
    expect(separator).toBe('一二三四五六七八九十、一二三四五六七等');
    expect(Array.from(separator).length).toBeLessThanOrEqual(20);
  });

  test('slotsInWindow keeps distinct times inside (after, time], ascending', () => {
    expect(slotsInWindow(['08:05', '08:00', '08:05', '07:59', '08:11'], { time: '08:10', after: '08:00' })).toEqual(['08:05']);
    expect(slotsInWindow(['08:10', '08:01'], { time: '08:10', after: '08:00' })).toEqual(['08:01', '08:10']);
    expect(slotsInWindow(['00:00', '00:03', '00:06'], { time: '00:05', after: null })).toEqual(['00:00', '00:03']);
    expect(slotsInWindow([], { time: '08:10', after: '08:00' })).toEqual([]);
  });

  test('buildMedicationMessage maps values onto the configured field keys and deep-links to the slot', () => {
    expect(buildMedicationMessage({ id: 'tmpl-x', fields: ['date1', 'thing2', 'thing9'] }, 'openid-a', DAY, '08:00', ['二甲双胍', '阿卡波糖'], 'formal')).toEqual({
      touser: 'openid-a',
      template_id: 'tmpl-x',
      page: 'pages/medications/index?slot=08:00&from=reminder',
      miniprogram_state: 'formal',
      lang: 'zh_CN',
      data: { date1: { value: '2026-09-09 08:00' }, thing2: { value: '二甲双胍、阿卡波糖' }, thing9: { value: '请按医生要求服用' } }
    });
  });
});

describe('medication API', () => {
  test('GET returns an empty list, empty today, a disabled reminder and the configured template', async () => {
    const { headers } = await account('med-empty');
    const res = await app.inject({ url: '/api/app/medications', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      medications: [],
      today: { day: localDayKey(new Date()), slots: [] },
      reminder: { enabled: false, quota: 0 },
      template: 'test-medication-reminder-template'
    });
  });

  test('POST creates with trimmed name and normalized times; GET lists in creation order and groups today by slot', async () => {
    const { headers } = await account('med-create');
    const first = await app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: { name: ' 二甲双胍 ', times: ['21:00', '06:00', '06:00'] } });
    expect(first.statusCode).toBe(201);
    expect(first.json().medication).toEqual({ id: expect.any(String), name: '二甲双胍', times: ['06:00', '21:00'] });
    const second = await app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: { name: '阿卡波糖', times: ['06:00'] } });
    expect(second.statusCode).toBe(201);
    const list = await app.inject({ url: '/api/app/medications', headers });
    expect(list.json().medications).toEqual([
      { id: first.json().medication.id, name: '二甲双胍', times: ['06:00', '21:00'] },
      { id: second.json().medication.id, name: '阿卡波糖', times: ['06:00'] }
    ]);
    expect(list.json().today.slots).toEqual([
      { time: '06:00', items: [
        { medicationId: first.json().medication.id, name: '二甲双胍', taken: false },
        { medicationId: second.json().medication.id, name: '阿卡波糖', taken: false }
      ] },
      { time: '21:00', items: [{ medicationId: first.json().medication.id, name: '二甲双胍', taken: false }] }
    ]);
  });

  test('POST rejects bad names, bad times and extra fields', async () => {
    const { headers } = await account('med-validation');
    const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: payload as any });
    expect((await post({ name: '', times: ['06:00'] })).statusCode).toBe(422);
    expect((await post({ name: '   ', times: ['06:00'] })).statusCode).toBe(422);
    expect((await post({ name: '一二三四五六七八九十一二三四五六七八九十一', times: ['06:00'] })).statusCode).toBe(422);
    expect((await post({ name: '一二三四五六七八九十一二三四五六七八九十', times: ['06:00'] })).statusCode).toBe(201);
    expect((await post({ name: '药', times: [] })).statusCode).toBe(422);
    expect((await post({ name: '药', times: ['01:00', '02:00', '03:00', '04:00', '05:00'] })).statusCode).toBe(422);
    expect((await post({ name: '药', times: ['6:00'] })).statusCode).toBe(422);
    expect((await post({ name: '药', times: ['25:00'] })).statusCode).toBe(422);
    expect((await post({ name: '药' })).statusCode).toBe(422);
    expect((await post({ name: '药', times: ['06:00'], dose: '1 片' })).statusCode).toBe(422);
    expect((await post({ name: '药', times: ['01:00', '02:00', '03:00', '04:00', '04:00'] })).statusCode).toBe(422);
    expect((await app.inject({ url: '/api/app/medications', headers })).json().medications).toHaveLength(1);
  });

  test('POST enforces the limit of 8 unarchived medications with MEDICATION_LIMIT', async () => {
    const { headers } = await account('med-limit');
    for (let i = 1; i <= 8; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: { name: `药${i}`, times: ['06:30'] } });
      expect(res.statusCode).toBe(201);
    }
    const ninth = await app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: { name: '药9', times: ['06:30'] } });
    expect(ninth.statusCode).toBe(422);
    expect(ninth.json().error.code).toBe('MEDICATION_LIMIT');
    const list = await app.inject({ url: '/api/app/medications', headers });
    expect(list.json().medications).toHaveLength(8);
    expect((await app.inject({ method: 'DELETE', url: `/api/app/medications/${list.json().medications[0].id}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: { name: '药9', times: ['06:30'] } })).statusCode).toBe(201);
  });

  test('PATCH updates name and times, returns 404 for foreign, unknown or archived medications', async () => {
    const owner = await account('med-patch');
    const other = await account('med-patch-other');
    const created = (await app.inject({ method: 'POST', url: '/api/app/medications', headers: owner.headers, payload: { name: '二甲双胍', times: ['06:00'] } })).json().medication;
    const renamed = await app.inject({ method: 'PATCH', url: `/api/app/medications/${created.id}`, headers: owner.headers, payload: { name: '格华止' } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().medication).toEqual({ id: created.id, name: '格华止', times: ['06:00'] });
    const retimed = await app.inject({ method: 'PATCH', url: `/api/app/medications/${created.id}`, headers: owner.headers, payload: { times: ['22:00', '06:00', '22:00'] } });
    expect(retimed.json().medication).toEqual({ id: created.id, name: '格华止', times: ['06:00', '22:00'] });
    expect((await app.inject({ method: 'PATCH', url: `/api/app/medications/${created.id}`, headers: owner.headers, payload: { times: [] } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PATCH', url: `/api/app/medications/${created.id}`, headers: owner.headers, payload: { name: 'x', extra: 1 } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PATCH', url: `/api/app/medications/${created.id}`, headers: other.headers, payload: { name: '偷改' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/api/app/medications/nope', headers: owner.headers, payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/app/medications/${created.id}`, headers: owner.headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PATCH', url: `/api/app/medications/${created.id}`, headers: owner.headers, payload: { name: 'x' } })).statusCode).toBe(404);
  });

  test('DELETE archives: hidden from the list and today, check-in history kept, second delete is 404', async () => {
    const { user, headers } = await account('med-archive');
    const today = localDayKey(new Date());
    const created = (await app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: { name: '二甲双胍', times: ['06:00'] } })).json().medication;
    expect((await app.inject({ method: 'POST', url: '/api/app/medications/checkins', headers, payload: { day: today, slot: '06:00', medicationId: created.id, taken: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/app/medications/${created.id}`, headers })).statusCode).toBe(204);
    const list = await app.inject({ url: '/api/app/medications', headers });
    expect(list.json().medications).toEqual([]);
    expect(list.json().today.slots).toEqual([]);
    expect((await prisma.medication.findUniqueOrThrow({ where: { id: created.id } })).archivedAt).not.toBeNull();
    expect(await prisma.medicationLog.count({ where: { medicationId: created.id } })).toBe(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/app/medications/${created.id}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/app/medications/nope', headers })).statusCode).toBe(404);
  });

  test('checkins only accept today, are idempotent, untaken deletes, wrong slot is 422', async () => {
    const owner = await account('med-checkin');
    const other = await account('med-checkin-other');
    const today = localDayKey(new Date());
    const yesterday = addDaysToKey(today, -1);
    const created = (await app.inject({ method: 'POST', url: '/api/app/medications', headers: owner.headers, payload: { name: '二甲双胍', times: ['06:15', '21:15'] } })).json().medication;
    const post = (payload: unknown, headers = owner.headers) => app.inject({ method: 'POST', url: '/api/app/medications/checkins', headers, payload: payload as any });

    const taken = await post({ day: today, slot: '06:15', medicationId: created.id, taken: true });
    expect(taken.statusCode).toBe(200);
    expect(taken.json()).toEqual({
      today: { day: today, slots: [
        { time: '06:15', items: [{ medicationId: created.id, name: '二甲双胍', taken: true }] },
        { time: '21:15', items: [{ medicationId: created.id, name: '二甲双胍', taken: false }] }
      ] }
    });
    const firstLog = await prisma.medicationLog.findUniqueOrThrow({ where: { medicationId_day_slot: { medicationId: created.id, day: today, slot: '06:15' } } });
    expect(firstLog.userId).toBe(owner.user.id);

    const again = await post({ day: today, slot: '06:15', medicationId: created.id, taken: true });
    expect(again.statusCode).toBe(200);
    expect(await prisma.medicationLog.count({ where: { medicationId: created.id } })).toBe(1);
    expect((await prisma.medicationLog.findUniqueOrThrow({ where: { id: firstLog.id } })).takenAt).toEqual(firstLog.takenAt);

    const untaken = await post({ day: today, slot: '06:15', medicationId: created.id, taken: false });
    expect(untaken.statusCode).toBe(200);
    expect(untaken.json().today.slots[0].items[0].taken).toBe(false);
    expect(await prisma.medicationLog.count({ where: { medicationId: created.id } })).toBe(0);
    expect((await post({ day: today, slot: '06:15', medicationId: created.id, taken: false })).statusCode).toBe(200);

    const past = await post({ day: yesterday, slot: '06:15', medicationId: created.id, taken: true });
    expect(past.statusCode).toBe(422);
    expect(past.json().error.fields).toEqual({ day: [today] });
    expect((await post({ day: addDaysToKey(today, 1), slot: '06:15', medicationId: created.id, taken: true })).statusCode).toBe(422);
    expect((await post({ day: today, slot: '07:15', medicationId: created.id, taken: true })).statusCode).toBe(422);
    expect((await post({ day: today, slot: '6:15', medicationId: created.id, taken: true })).statusCode).toBe(422);
    expect((await post({ day: today, slot: '06:15', medicationId: created.id, taken: 'yes' })).statusCode).toBe(422);
    expect((await post({ day: today, slot: '06:15', medicationId: created.id, taken: true, note: 'x' })).statusCode).toBe(422);
    expect((await post({ day: today, slot: '06:15', medicationId: created.id, taken: true }, other.headers)).statusCode).toBe(404);
    expect((await post({ day: today, slot: '06:15', medicationId: 'nope', taken: true })).statusCode).toBe(404);
    expect(await prisma.medicationLog.count({ where: { medicationId: created.id } })).toBe(0);
  });

  test('reminder plan for medication ignores time and period, subscriptions add quota, templates list it', async () => {
    const { user, headers } = await account('med-plan');
    const enabled = await app.inject({ method: 'PUT', url: '/api/app/reminders/medication', headers, payload: { enabled: true } });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().plan).toEqual({ metric: 'medication', enabled: true, time: '00:00', period: null, quota: 0 });
    for (const payload of [{ enabled: true, time: '08:00' }, { enabled: true, period: 'fasting' }, { enabled: true, quota: 1 }]) {
      const res = await app.inject({ method: 'PUT', url: '/api/app/reminders/medication', headers, payload });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    const subscribed = await app.inject({ method: 'POST', url: '/api/app/reminders/subscriptions', headers, payload: { accepted: ['medication', 'medication', 'glucose'] } });
    expect(subscribed.statusCode).toBe(200);
    expect(subscribed.json().plans).toEqual([
      { metric: 'glucose', enabled: false, time: '07:00', period: 'fasting', quota: 1 },
      { metric: 'medication', enabled: true, time: '00:00', period: null, quota: 1 }
    ]);
    const medications = await app.inject({ url: '/api/app/medications', headers });
    expect(medications.json().reminder).toEqual({ enabled: true, quota: 1 });
    const reminders = await app.inject({ url: '/api/app/reminders', headers });
    expect(reminders.json().templates).toEqual({
      glucose: 'test-glucose-reminder-template',
      bp: 'test-bp-reminder-template',
      medication: 'test-medication-reminder-template'
    });
    const disabled = await app.inject({ method: 'PUT', url: '/api/app/reminders/medication', headers, payload: { enabled: false } });
    expect(disabled.json().plan).toEqual({ metric: 'medication', enabled: false, time: '00:00', period: null, quota: 1 });
    expect(await prisma.reminderPlan.count({ where: { userId: user.id } })).toBe(2);
  });

  test('medication reminder plans need a mini-program openid like the others', async () => {
    const web = await account('web:med-only', { miniOpenid: null });
    const res = await app.inject({ method: 'PUT', url: '/api/app/reminders/medication', headers: web.headers, payload: { enabled: true } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MINIPROGRAM_REQUIRED');
  });
});

describe('medication reminder tick', () => {
  test('sends one message per slot covering every medication due, logs the slot and decrements quota once', async () => {
    const { user } = await account('tick-med-merge');
    await seedMedication(user.id, '二甲双胍', ['08:00', '20:00']);
    await seedMedication(user.id, '阿卡波糖', ['08:00']);
    await seedPlan(user.id, 3);
    const wechat = fakeWechat();
    const result = await tick(shanghai(DAY, '08:04'), wechat.fetchImpl);
    expect(result).toMatchObject({ today: DAY, time: '08:04', due: 0, sent: 0, medicationDue: 1, medicationSent: 1, medicationSkipped: 0, medicationFailed: 0 });
    expect(wechat.sent).toHaveLength(1);
    expect(wechat.sent[0]!.url).toBe('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=token-1');
    expect(wechat.sent[0]!.body).toEqual({
      touser: 'mini_tick-med-merge',
      template_id: 'tmpl-medication',
      page: 'pages/medications/index?slot=08:00&from=reminder',
      miniprogram_state: 'trial',
      lang: 'zh_CN',
      data: { time1: { value: '2026-09-09 08:00' }, thing2: { value: '二甲双胍、阿卡波糖' }, thing3: { value: '请按医生要求服用' } }
    });
    const plan = await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } });
    expect(plan).toMatchObject({ quota: 2, enabled: true, lastSentDay: null });
    const logs = await prisma.reminderLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ metric: 'medication', templateKey: medicationTemplateKey, scheduledDay: DAY, slot: '08:00', ok: true, errcode: null, errmsg: 'ok' });

    // Same day, same slot, still inside the window: nothing is resent and the token is reused.
    const again = await tick(shanghai(DAY, '08:09'), wechat.fetchImpl);
    expect(again).toMatchObject({ medicationDue: 0, medicationSent: 0 });
    expect(wechat.sent).toHaveLength(1);
    expect(wechat.tokenRequests()).toBe(1);
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } })).quota).toBe(2);
    // The 20:00 slot is outside this window.
    expect(await prisma.reminderLog.count({ where: { userId: user.id, slot: '20:00' } })).toBe(0);
  });

  test('truncates the names field to 20 characters with a trailing 等', async () => {
    const { user } = await account('tick-med-names');
    await seedMedication(user.id, '一二三四五六七八九十', ['09:00']);
    await seedMedication(user.id, '甲乙丙丁戊己庚辛壬癸', ['09:00']);
    await seedMedication(user.id, '子丑', ['09:00']);
    await seedPlan(user.id, 1);
    const wechat = fakeWechat();
    expect(await tick(shanghai(DAY, '09:00'), wechat.fetchImpl)).toMatchObject({ medicationDue: 1, medicationSent: 1 });
    const value = wechat.sent[0]!.body.data.thing2.value as string;
    expect(value).toBe('一二三四五六七八九十、甲乙丙丁戊己庚辛等');
    expect(Array.from(value)).toHaveLength(20);
  });

  test('skips a slot whose medications are all checked in, writing an all_taken placeholder without spending quota', async () => {
    const { user } = await account('tick-med-taken');
    const a = await seedMedication(user.id, '二甲双胍', ['10:00']);
    const b = await seedMedication(user.id, '阿卡波糖', ['10:00']);
    await seedLog(user.id, a.id, DAY, '10:00');
    await seedLog(user.id, b.id, DAY, '10:00');
    // A check-in for another day or slot does not count.
    await seedLog(user.id, a.id, addDaysToKey(DAY, -1), '10:00');
    await seedPlan(user.id, 2);
    const wechat = fakeWechat();
    const result = await tick(shanghai(DAY, '10:02'), wechat.fetchImpl);
    expect(result).toMatchObject({ medicationDue: 1, medicationSent: 0, medicationSkipped: 1, medicationFailed: 0 });
    expect(wechat.sent).toHaveLength(0);
    expect(wechat.tokenRequests()).toBe(0);
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } })).quota).toBe(2);
    const logs = await prisma.reminderLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ templateKey: medicationTemplateKey, scheduledDay: DAY, slot: '10:00', ok: true, errcode: null, errmsg: 'all_taken' });
    // The placeholder blocks a resend for the rest of the window even if a check-in is undone.
    await prisma.medicationLog.deleteMany({ where: { medicationId: b.id, day: DAY } });
    expect(await tick(shanghai(DAY, '10:06'), wechat.fetchImpl)).toMatchObject({ medicationDue: 0, medicationSkipped: 0 });
    expect(wechat.sent).toHaveLength(0);
  });

  test('still sends when only some of the slot medications are checked in', async () => {
    const { user } = await account('tick-med-partial');
    const a = await seedMedication(user.id, '二甲双胍', ['11:00']);
    await seedMedication(user.id, '阿卡波糖', ['11:00']);
    await seedLog(user.id, a.id, DAY, '11:00');
    await seedPlan(user.id, 2);
    const wechat = fakeWechat();
    expect(await tick(shanghai(DAY, '11:00'), wechat.fetchImpl)).toMatchObject({ medicationDue: 1, medicationSent: 1, medicationSkipped: 0 });
    // Both names are listed: the message is per slot, not per medication.
    expect(wechat.sent[0]!.body.data.thing2.value).toBe('二甲双胍、阿卡波糖');
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } })).quota).toBe(1);
  });

  test('several slots in one window each get a message while quota lasts', async () => {
    const rich = await account('tick-med-slots');
    const poor = await account('tick-med-slots-poor');
    for (const { user } of [rich, poor]) {
      await seedMedication(user.id, '甲药', ['12:01']);
      await seedMedication(user.id, '乙药', ['12:04', '12:11']);
    }
    await seedPlan(rich.user.id, 5);
    await seedPlan(poor.user.id, 1);
    const wechat = fakeWechat();
    const result = await tick(shanghai(DAY, '12:10'), wechat.fetchImpl);
    expect(result).toMatchObject({ medicationDue: 3, medicationSent: 3, medicationFailed: 0 });
    const byUser = (touser: string) => wechat.sent.filter((item) => item.body.touser === touser).map((item) => item.body.page);
    expect(byUser('mini_tick-med-slots')).toEqual([
      'pages/medications/index?slot=12:01&from=reminder',
      'pages/medications/index?slot=12:04&from=reminder'
    ]);
    expect(byUser('mini_tick-med-slots-poor')).toEqual(['pages/medications/index?slot=12:01&from=reminder']);
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: rich.user.id } })).quota).toBe(3);
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: poor.user.id } })).quota).toBe(0);
    // The slot the poor user could not afford has no log, so it stays due once quota comes back; 12:11 was never due.
    expect(await prisma.reminderLog.count({ where: { userId: poor.user.id } })).toBe(1);
    expect(await prisma.reminderLog.count({ where: { scheduledDay: DAY, slot: '12:11' } })).toBe(0);
    expect(wechat.tokenRequests()).toBe(1);
  });

  test('errcode 43101 clears the quota and 40003 disables the plan; both stop the user for the day', async () => {
    const rejected = await account('tick-med-43101');
    const invalid = await account('tick-med-40003');
    for (const { user } of [rejected, invalid]) {
      await seedMedication(user.id, '甲药', ['13:00', '13:03']);
      await seedPlan(user.id, 5);
    }
    const wechat = fakeWechat((message) => message.touser === 'mini_tick-med-43101'
      ? { errcode: 43101, errmsg: 'user refuse to accept the msg' }
      : { errcode: 40003, errmsg: 'invalid openid' });
    const result = await tick(shanghai(DAY, '13:05'), wechat.fetchImpl);
    expect(result).toMatchObject({ medicationDue: 2, medicationSent: 0, medicationFailed: 2 });
    expect(wechat.sent).toHaveLength(2);
    expect(await prisma.reminderPlan.findFirstOrThrow({ where: { userId: rejected.user.id } })).toMatchObject({ quota: 0, enabled: true });
    expect(await prisma.reminderPlan.findFirstOrThrow({ where: { userId: invalid.user.id } })).toMatchObject({ quota: 5, enabled: false });
    expect(await prisma.reminderLog.findFirst({ where: { userId: rejected.user.id } })).toMatchObject({ slot: '13:00', ok: false, errcode: 43101, errmsg: 'user refuse to accept the msg' });
    expect(await prisma.reminderLog.findFirst({ where: { userId: invalid.user.id } })).toMatchObject({ slot: '13:00', ok: false, errcode: 40003 });
    // Neither user is eligible any more, so the 13:03 slot is not attempted.
    expect(await tick(shanghai(DAY, '13:06'), wechat.fetchImpl)).toMatchObject({ medicationDue: 0 });
    expect(wechat.sent).toHaveLength(2);
  });

  test('errcode 47003 keeps quota and a failed slot is not retried the same day', async () => {
    const { user } = await account('tick-med-47003');
    await seedMedication(user.id, '甲药', ['14:00']);
    await seedPlan(user.id, 2);
    const wechat = fakeWechat(() => ({ errcode: 47003, errmsg: 'argument invalid' }));
    const errors: unknown[] = [];
    expect(await tick(shanghai(DAY, '14:00'), wechat.fetchImpl, { log: { ...silentLog, error: (obj) => errors.push(obj) } })).toMatchObject({ medicationDue: 1, medicationFailed: 1 });
    expect(errors).toHaveLength(1);
    expect(await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ quota: 2, enabled: true });
    expect(await prisma.reminderLog.findFirst({ where: { userId: user.id } })).toMatchObject({ slot: '14:00', ok: false, errcode: 47003 });
    expect(await tick(shanghai(DAY, '14:05'), wechat.fetchImpl)).toMatchObject({ medicationDue: 0 });
    expect(wechat.sent).toHaveLength(1);
  });

  test('archived medications neither count as due nor appear in the names', async () => {
    const alone = await account('tick-med-archived-alone');
    const mixed = await account('tick-med-archived-mixed');
    await seedMedication(alone.user.id, '停用药', ['15:00'], { archivedAt: shanghai(DAY, '07:00') });
    await seedPlan(alone.user.id, 3);
    await seedMedication(mixed.user.id, '停用药', ['15:00'], { archivedAt: shanghai(DAY, '07:00') });
    await seedMedication(mixed.user.id, '在用药', ['15:00']);
    await seedPlan(mixed.user.id, 3);
    const wechat = fakeWechat();
    expect(await tick(shanghai(DAY, '15:00'), wechat.fetchImpl)).toMatchObject({ medicationDue: 1, medicationSent: 1 });
    expect(wechat.sent).toHaveLength(1);
    expect(wechat.sent[0]!.body.touser).toBe('mini_tick-med-archived-mixed');
    expect(wechat.sent[0]!.body.data.thing2.value).toBe('在用药');
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: alone.user.id } })).quota).toBe(3);
  });

  test('disabled plans, exhausted quota, deactivated users and users without medications are never due', async () => {
    const disabled = await account('tick-med-disabled');
    const empty = await account('tick-med-empty-quota');
    const gone = await account('tick-med-deactivated');
    const noMeds = await account('tick-med-none');
    for (const { user } of [disabled, empty, gone]) await seedMedication(user.id, '甲药', ['16:00']);
    await seedPlan(disabled.user.id, 3, false);
    await seedPlan(empty.user.id, 0);
    await seedPlan(gone.user.id, 3);
    await seedPlan(noMeds.user.id, 3);
    await prisma.user.update({ where: { id: gone.user.id }, data: { deactivatedAt: new Date() } });
    const wechat = fakeWechat();
    expect(await tick(shanghai(DAY, '16:00'), wechat.fetchImpl)).toMatchObject({ due: 0, medicationDue: 0, medicationSent: 0 });
    expect(wechat.sent).toHaveLength(0);
  });

  test('a user with no mini-program openid gets the plan disabled instead of a send', async () => {
    const { user } = await account('local:tick-med-nomini', { miniOpenid: null });
    await seedMedication(user.id, '甲药', ['17:00']);
    await seedPlan(user.id, 3);
    const wechat = fakeWechat();
    expect(await tick(shanghai(DAY, '17:00'), wechat.fetchImpl)).toMatchObject({ medicationDue: 1, medicationFailed: 1 });
    expect(wechat.sent).toHaveLength(0);
    expect(await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ enabled: false, quota: 3 });
  });

  test('the medication plan placeholder time never fires as a measurement reminder around midnight', async () => {
    const { user } = await account('tick-med-midnight');
    await seedMedication(user.id, '甲药', ['18:00']);
    await seedPlan(user.id, 3);
    const wechat = fakeWechat();
    // 00:03 Asia/Shanghai: the measurement pass window is [.., 00:03] with no lower bound, which would match time '00:00'.
    expect(await tick(shanghai(DAY, '00:03'), wechat.fetchImpl)).toMatchObject({ due: 0, sent: 0, medicationDue: 0 });
    expect(wechat.sent).toHaveLength(0);
    expect(await prisma.reminderLog.count({ where: { userId: user.id } })).toBe(0);
  });

  test('measurement and medication reminders for the same user go out in one tick with one token', async () => {
    const { user } = await account('tick-med-alongside');
    await seedMedication(user.id, '甲药', ['19:00']);
    await seedPlan(user.id, 2);
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'glucose', enabled: true, time: '19:00', period: 'fasting', quota: 2 } });
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'bp', enabled: true, time: '19:02', quota: 2 } });
    const wechat = fakeWechat();
    const result = await tick(shanghai(DAY, '19:05'), wechat.fetchImpl);
    expect(result).toMatchObject({ due: 2, sent: 2, skipped: 0, failed: 0, medicationDue: 1, medicationSent: 1 });
    expect(wechat.sent.map((item) => item.body.template_id)).toEqual(['tmpl-glucose', 'tmpl-bp', 'tmpl-medication']);
    expect(wechat.tokenRequests()).toBe(1);
    const plans = await prisma.reminderPlan.findMany({ where: { userId: user.id }, orderBy: { metric: 'asc' } });
    expect(plans.map((plan) => [plan.metric, plan.quota, plan.lastSentDay])).toEqual([
      ['bp', 1, DAY],
      ['glucose', 1, DAY],
      ['medication', 1, null]
    ]);
    const logs = await prisma.reminderLog.findMany({ where: { userId: user.id }, orderBy: { templateKey: 'asc' } });
    expect(logs.map((log) => [log.templateKey, log.slot])).toEqual([
      ['bp_reminder', null],
      ['glucose_reminder', null],
      ['medication_reminder', '19:00']
    ]);
  });

  test('a failed access_token request aborts both passes without touching plans or logs', async () => {
    const { user } = await account('tick-med-no-token');
    await seedMedication(user.id, '甲药', ['21:00']);
    await seedPlan(user.id, 1);
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'bp', enabled: true, time: '21:00', quota: 1 } });
    const wechat = fakeWechat(undefined, { errcode: 40013, errmsg: 'invalid appid' });
    const errors: unknown[] = [];
    const result = await tick(shanghai(DAY, '21:00'), wechat.fetchImpl, { log: { ...silentLog, error: (obj) => errors.push(obj) } });
    expect(result).toMatchObject({ due: 1, failed: 1, medicationDue: 0, medicationSent: 0, medicationFailed: 0 });
    expect(wechat.sent).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(await prisma.reminderLog.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id, metric: 'medication' } })).quota).toBe(1);
  });
});

describe('weekly medication section', () => {
  test('counts planned doses per day for medications that existed that day, including those added or archived mid-week', async () => {
    const { user } = await account('weekly-med-counts');
    const from = shanghai('2026-09-03', '00:00');
    const to = shanghai('2026-09-09', '12:00');
    // Existed all week: 7 days × 2 times.
    const allWeek = await seedMedication(user.id, '甲药', ['07:00', '19:00'], { createdAt: shanghai('2026-09-01', '10:00') });
    // Added mid-week on the 6th: 6th–9th, 1 time.
    const added = await seedMedication(user.id, '乙药', ['12:00'], { createdAt: shanghai('2026-09-06', '10:00') });
    // Archived mid-week on the 5th at 08:00: counts on 3rd, 4th and 5th, 1 time.
    const archived = await seedMedication(user.id, '丙药', ['07:00'], { createdAt: shanghai('2026-08-20', '10:00'), archivedAt: shanghai('2026-09-05', '08:00') });
    // Archived before the week and added after the week: never counted.
    await seedMedication(user.id, '丁药', ['07:00'], { createdAt: shanghai('2026-08-01', '10:00'), archivedAt: shanghai('2026-09-02', '23:00') });
    await seedMedication(user.id, '戊药', ['07:00'], { createdAt: shanghai('2026-09-10', '10:00') });
    await seedLog(user.id, allWeek.id, '2026-09-03', '07:00');
    await seedLog(user.id, allWeek.id, '2026-09-09', '19:00');
    await seedLog(user.id, added.id, '2026-09-07', '12:00');
    await seedLog(user.id, archived.id, '2026-09-04', '07:00');
    await seedLog(user.id, allWeek.id, '2026-09-02', '07:00'); // outside the range
    expect(await weeklyMedicationSection(prisma, user.id, from, to)).toEqual({ planned: 14 + 4 + 3, taken: 4 });
    // A single day range and an inverted range.
    expect(await weeklyMedicationSection(prisma, user.id, shanghai('2026-09-05', '00:00'), shanghai('2026-09-05', '23:59'))).toEqual({ planned: 3, taken: 0 });
    expect(await weeklyMedicationSection(prisma, user.id, to, from)).toEqual({ planned: 0, taken: 0 });
  });

  test('the weekly report includes sections.medication only when something was planned', async () => {
    const { headers } = await account('weekly-med-report');
    const before = await app.inject({ url: '/api/app/report/weekly', headers });
    expect(before.statusCode).toBe(200);
    expect(before.json().sections.medication).toBeUndefined();
    const created = (await app.inject({ method: 'POST', url: '/api/app/medications', headers, payload: { name: '二甲双胍', times: ['05:00', '23:00'] } })).json().medication;
    const planned = await app.inject({ url: '/api/app/report/weekly', headers });
    expect(planned.json().sections.medication).toEqual({ planned: 2, taken: 0 });
    const today = localDayKey(new Date());
    expect((await app.inject({ method: 'POST', url: '/api/app/medications/checkins', headers, payload: { day: today, slot: '05:00', medicationId: created.id, taken: true } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/app/report/weekly', headers })).json().sections.medication).toEqual({ planned: 2, taken: 1 });
  });
});

describe('account deactivation', () => {
  test('removes medications, check-in logs and the medication reminder plan', async () => {
    const { user, headers } = await account('med-deactivate');
    const medication = await seedMedication(user.id, '甲药', ['05:30']);
    await seedLog(user.id, medication.id, DAY, '05:30');
    await seedPlan(user.id, 2);
    await prisma.reminderLog.create({ data: { userId: user.id, metric: 'medication', templateKey: medicationTemplateKey, scheduledDay: DAY, slot: '05:30', ok: true } });
    expect((await app.inject({ method: 'DELETE', url: '/api/app/me', headers })).statusCode).toBe(204);
    expect(await prisma.medication.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.medicationLog.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.reminderPlan.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.reminderLog.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deactivatedAt).not.toBeNull();
  });
});
