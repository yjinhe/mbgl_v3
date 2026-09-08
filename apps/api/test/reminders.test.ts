import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import {
  REMINDER_QUOTA_MAX,
  buildReminderMessage,
  reminderWindow,
  runReminderTick,
  type ReminderConfig,
  type ReminderTickDeps
} from '../src/services/reminders.js';
import { resetWechatTokenCache } from '../src/services/wechat-token.js';
import { createSqliteSchema } from './setup-db.js';

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tangji-reminders-'));
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

const reminderConfig: ReminderConfig = {
  wechatAppId: 'wx-test-appid',
  wechatSecret: 'wx-test-secret',
  miniprogramState: 'trial',
  reminderTemplates: {
    glucose: { id: 'tmpl-glucose', fields: ['time1', 'thing2', 'thing3'] },
    bp: { id: 'tmpl-bp', fields: ['time1', 'thing2'] }
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

// 2026-09-09 07:30 in Asia/Shanghai is still 2026-09-08 in UTC.
const shanghai = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`);

describe('reminder plan API', () => {
  test('GET returns configured template ids and no plans for a new user', async () => {
    const { headers } = await account('reminder-empty');
    const res = await app.inject({ url: '/api/app/reminders', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      plans: [],
      templates: {
        glucose: 'test-glucose-reminder-template',
        bp: 'test-bp-reminder-template',
        medication: 'test-medication-reminder-template'
      }
    });
  });

  test('PUT creates and updates a plan, keeping time and period when omitted', async () => {
    const { user, headers } = await account('reminder-put');
    const created = await app.inject({ method: 'PUT', url: '/api/app/reminders/glucose', headers, payload: { enabled: true, time: '07:00', period: 'before_lunch' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().plan).toEqual({ metric: 'glucose', enabled: true, time: '07:00', period: 'before_lunch', quota: 0 });
    const disabled = await app.inject({ method: 'PUT', url: '/api/app/reminders/glucose', headers, payload: { enabled: false } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().plan).toMatchObject({ enabled: false, time: '07:00', period: 'before_lunch' });
    const bp = await app.inject({ method: 'PUT', url: '/api/app/reminders/bp', headers, payload: { enabled: true, time: '21:15' } });
    expect(bp.statusCode).toBe(200);
    expect(bp.json().plan).toEqual({ metric: 'bp', enabled: true, time: '21:15', period: null, quota: 0 });
    expect(await prisma.reminderPlan.count({ where: { userId: user.id } })).toBe(2);
    const list = await app.inject({ url: '/api/app/reminders', headers });
    expect(list.json().plans.map((plan: { metric: string }) => plan.metric)).toEqual(['glucose', 'bp']);
  });

  test('PUT rejects an invalid metric, time, period, extra fields and a period on bp', async () => {
    const { headers } = await account('reminder-validation');
    const put = (metric: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/app/reminders/${metric}`, headers, payload: payload as any });
    expect((await put('lipid', { enabled: true, time: '07:00' })).statusCode).toBe(422);
    expect((await put('glucose', { enabled: true, time: '25:00' })).statusCode).toBe(422);
    expect((await put('glucose', { enabled: true, time: '7:00' })).statusCode).toBe(422);
    expect((await put('glucose', { enabled: true, time: '07:00', period: 'nonsense' })).statusCode).toBe(422);
    expect((await put('glucose', { enabled: true, time: '07:00', quota: 30 })).statusCode).toBe(422);
    expect((await put('glucose', { enabled: 'yes', time: '07:00' })).statusCode).toBe(422);
    const bpWithPeriod = await put('bp', { enabled: true, time: '07:30', period: 'fasting' });
    expect(bpWithPeriod.statusCode).toBe(422);
    expect(bpWithPeriod.json().error.code).toBe('VALIDATION_FAILED');
    expect((await app.inject({ url: '/api/app/reminders', headers })).json().plans).toEqual([]);
  });

  test('PUT returns MINIPROGRAM_REQUIRED for web-only and password-only accounts but accepts legacy mini-program accounts', async () => {
    const web = await account('web:openid-only', { miniOpenid: null });
    const local = await account('local:someone', { miniOpenid: null });
    const legacy = await account('legacy-raw-openid', { miniOpenid: null });
    const payload = { enabled: true, time: '07:00' };
    for (const { headers } of [web, local]) {
      const res = await app.inject({ method: 'PUT', url: '/api/app/reminders/glucose', headers, payload });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('MINIPROGRAM_REQUIRED');
    }
    expect((await app.inject({ method: 'PUT', url: '/api/app/reminders/glucose', headers: legacy.headers, payload })).statusCode).toBe(200);
  });

  test('subscriptions accumulate quota per accepted metric, cap at 30 and work before a plan is enabled', async () => {
    const { user, headers } = await account('reminder-quota');
    const post = (accepted: unknown) => app.inject({ method: 'POST', url: '/api/app/reminders/subscriptions', headers, payload: { accepted } });
    const first = await post(['glucose', 'bp']);
    expect(first.statusCode).toBe(200);
    expect(first.json().plans).toEqual([
      { metric: 'glucose', enabled: false, time: '07:00', period: 'fasting', quota: 1 },
      { metric: 'bp', enabled: false, time: '07:30', period: null, quota: 1 }
    ]);
    const duplicated = await post(['glucose', 'glucose']);
    expect(duplicated.json().plans[0].quota).toBe(2);
    expect(duplicated.json().plans[1].quota).toBe(1);
    for (let i = 0; i < REMINDER_QUOTA_MAX + 3; i += 1) await post(['glucose']);
    const plan = await prisma.reminderPlan.findUniqueOrThrow({ where: { userId_metric: { userId: user.id, metric: 'glucose' } } });
    expect(plan.quota).toBe(REMINDER_QUOTA_MAX);
    expect(plan.enabled).toBe(false);
    const enabled = await app.inject({ method: 'PUT', url: '/api/app/reminders/glucose', headers, payload: { enabled: true, time: '08:00' } });
    expect(enabled.json().plan.quota).toBe(REMINDER_QUOTA_MAX);
    expect((await post(['lipid'])).statusCode).toBe(422);
    expect((await post([])).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/app/reminders/subscriptions', headers, payload: { accepted: ['bp'], extra: 1 } })).statusCode).toBe(422);
  });

  test('deactivating the account removes reminder plans and logs', async () => {
    const { user, headers } = await account('reminder-deactivate');
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'glucose', enabled: true, time: '07:00', period: 'fasting', quota: 3 } });
    await prisma.reminderLog.create({ data: { userId: user.id, metric: 'glucose', templateKey: 'glucose_reminder', scheduledDay: '2026-09-08', ok: true } });
    expect((await app.inject({ method: 'DELETE', url: '/api/app/me', headers })).statusCode).toBe(204);
    expect(await prisma.reminderPlan.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.reminderLog.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deactivatedAt).not.toBeNull();
  });
});

describe('reminder tick', () => {
  test('window and day key follow Asia/Shanghai, including across the UTC day boundary', () => {
    expect(reminderWindow(new Date('2026-09-08T23:30:00Z'))).toEqual({ today: '2026-09-09', time: '07:30', after: '07:20' });
    expect(reminderWindow(new Date('2026-09-08T16:05:00Z'))).toEqual({ today: '2026-09-09', time: '00:05', after: null });
    expect(reminderWindow(new Date('2026-09-08T15:59:00Z'))).toEqual({ today: '2026-09-08', time: '23:59', after: '23:49' });
  });

  test('builds the message from configured field keys in order', () => {
    const glucose = buildReminderMessage({ metric: 'glucose', time: '07:30', period: 'before_dinner' }, reminderConfig.reminderTemplates.glucose!, 'openid-a', '2026-09-09', 'trial');
    expect(glucose).toEqual({
      touser: 'openid-a',
      template_id: 'tmpl-glucose',
      page: 'pages/record/index?metric=glucose&period=before_dinner&from=reminder',
      miniprogram_state: 'trial',
      lang: 'zh_CN',
      data: { time1: { value: '2026-09-09 07:30' }, thing2: { value: '晚餐前' }, thing3: { value: '饭前测，洗净手指' } }
    });
    const bp = buildReminderMessage({ metric: 'bp', time: '21:00', period: null }, { id: 'bp-x', fields: ['date2', 'thing5'] }, 'openid-b', '2026-09-09', 'formal');
    expect(bp.page).toBe('pages/record/index?metric=bp&from=reminder');
    expect(bp.data).toEqual({ date2: { value: '2026-09-09 21:00' }, thing5: { value: '静坐五分钟后再量' } });
  });

  test('sends once per day at 07:30 Asia/Shanghai even when UTC is still the previous day, and decrements quota', async () => {
    const { user } = await account('tick-send');
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'glucose', enabled: true, time: '07:30', period: 'fasting', quota: 2 } });
    const wechat = fakeWechat();
    const now = new Date('2026-09-08T23:30:00Z');
    const first = await tick(now, wechat.fetchImpl);
    expect(first).toMatchObject({ today: '2026-09-09', time: '07:30', due: 1, sent: 1, skipped: 0, failed: 0 });
    expect(wechat.sent).toHaveLength(1);
    expect(wechat.sent[0]!.url).toBe('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=token-1');
    expect(wechat.sent[0]!.body).toEqual({
      touser: 'mini_tick-send',
      template_id: 'tmpl-glucose',
      page: 'pages/record/index?metric=glucose&period=fasting&from=reminder',
      miniprogram_state: 'trial',
      lang: 'zh_CN',
      data: { time1: { value: '2026-09-09 07:30' }, thing2: { value: '空腹' }, thing3: { value: '起床后先测再吃早饭' } }
    });
    const plan = await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } });
    expect(plan.quota).toBe(1);
    expect(plan.lastSentDay).toBe('2026-09-09');
    const logs = await prisma.reminderLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ metric: 'glucose', templateKey: 'glucose_reminder', scheduledDay: '2026-09-09', ok: true, errcode: null });

    const again = await tick(new Date('2026-09-08T23:35:00Z'), wechat.fetchImpl);
    expect(again).toMatchObject({ due: 0, sent: 0 });
    expect(wechat.sent).toHaveLength(1);
    expect(wechat.tokenRequests()).toBe(1);
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } })).quota).toBe(1);
  });

  test('only plans inside the 10-minute window are due', async () => {
    const early = await account('tick-window-early');
    const late = await account('tick-window-late');
    const future = await account('tick-window-future');
    await prisma.reminderPlan.create({ data: { userId: early.user.id, metric: 'bp', enabled: true, time: '09:00', quota: 1 } });
    await prisma.reminderPlan.create({ data: { userId: late.user.id, metric: 'bp', enabled: true, time: '09:01', quota: 1 } });
    await prisma.reminderPlan.create({ data: { userId: future.user.id, metric: 'bp', enabled: true, time: '09:11', quota: 1 } });
    const wechat = fakeWechat();
    const result = await tick(shanghai('2026-09-09', '09:10'), wechat.fetchImpl);
    expect(result).toMatchObject({ due: 1, sent: 1 });
    expect(wechat.sent[0]!.body).toMatchObject({
      touser: 'mini_tick-window-late',
      template_id: 'tmpl-bp',
      page: 'pages/record/index?metric=bp&from=reminder',
      data: { time1: { value: '2026-09-09 09:01' }, thing2: { value: '静坐五分钟后再量' } }
    });
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: early.user.id } })).lastSentDay).toBeNull();
    expect((await prisma.reminderPlan.findFirstOrThrow({ where: { userId: future.user.id } })).lastSentDay).toBeNull();
  });

  test('skips sending and keeps quota when the metric was already recorded today in Asia/Shanghai', async () => {
    const { user } = await account('tick-recorded');
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'glucose', enabled: true, time: '10:00', period: 'fasting', quota: 2 } });
    // 06:00 on 2026-09-09 in Shanghai, i.e. 2026-09-08 22:00 UTC.
    await prisma.glucoseRecord.create({ data: { userId: user.id, valueMmol: 5.8, period: 'fasting', measuredAt: new Date('2026-09-08T22:00:00Z') } });
    const wechat = fakeWechat();
    const result = await tick(shanghai('2026-09-09', '10:00'), wechat.fetchImpl);
    expect(result).toMatchObject({ due: 1, sent: 0, skipped: 1 });
    expect(wechat.sent).toHaveLength(0);
    const plan = await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } });
    expect(plan.quota).toBe(2);
    expect(plan.lastSentDay).toBe('2026-09-09');
    expect(await prisma.reminderLog.count({ where: { userId: user.id } })).toBe(0);
  });

  test('a deleted record or a record from yesterday does not count as recorded today', async () => {
    const { user } = await account('tick-yesterday');
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'bp', enabled: true, time: '11:00', quota: 1 } });
    await prisma.bpRecord.create({ data: { userId: user.id, sbp: 120, dbp: 80, period: 'morning', measuredAt: new Date('2026-09-08T15:30:00Z') } });
    await prisma.bpRecord.create({ data: { userId: user.id, sbp: 120, dbp: 80, period: 'morning', measuredAt: new Date('2026-09-09T01:00:00Z'), deletedAt: new Date() } });
    const wechat = fakeWechat();
    expect(await tick(shanghai('2026-09-09', '11:00'), wechat.fetchImpl)).toMatchObject({ due: 1, sent: 1 });
  });

  test('errcode 43101 clears the quota and 40003 disables the plan', async () => {
    const rejected = await account('tick-43101');
    const invalid = await account('tick-40003');
    await prisma.reminderPlan.create({ data: { userId: rejected.user.id, metric: 'glucose', enabled: true, time: '12:00', period: 'fasting', quota: 5 } });
    await prisma.reminderPlan.create({ data: { userId: invalid.user.id, metric: 'bp', enabled: true, time: '12:00', quota: 5 } });
    const wechat = fakeWechat((message) => message.touser === 'mini_tick-43101'
      ? { errcode: 43101, errmsg: 'user refuse to accept the msg' }
      : { errcode: 40003, errmsg: 'invalid openid' });
    const result = await tick(shanghai('2026-09-09', '12:00'), wechat.fetchImpl);
    expect(result).toMatchObject({ due: 2, sent: 0, failed: 2 });
    const rejectedPlan = await prisma.reminderPlan.findFirstOrThrow({ where: { userId: rejected.user.id } });
    expect(rejectedPlan).toMatchObject({ quota: 0, enabled: true, lastSentDay: null });
    const invalidPlan = await prisma.reminderPlan.findFirstOrThrow({ where: { userId: invalid.user.id } });
    expect(invalidPlan).toMatchObject({ quota: 5, enabled: false, lastSentDay: null });
    expect(await prisma.reminderLog.findFirst({ where: { userId: rejected.user.id } })).toMatchObject({ ok: false, errcode: 43101, errmsg: 'user refuse to accept the msg' });
    expect(await prisma.reminderLog.findFirst({ where: { userId: invalid.user.id } })).toMatchObject({ ok: false, errcode: 40003 });
  });

  test('errcode 47003 only logs, other errors mark the day so the plan is not retried until tomorrow', async () => {
    const format = await account('tick-47003');
    const other = await account('tick-other');
    await prisma.reminderPlan.create({ data: { userId: format.user.id, metric: 'glucose', enabled: true, time: '13:00', period: 'fasting', quota: 2 } });
    await prisma.reminderPlan.create({ data: { userId: other.user.id, metric: 'glucose', enabled: true, time: '13:00', period: 'fasting', quota: 2 } });
    const wechat = fakeWechat((message) => message.touser === 'mini_tick-47003'
      ? { errcode: 47003, errmsg: 'argument invalid' }
      : { errcode: 45009, errmsg: 'reach max api daily quota limit' });
    expect(await tick(shanghai('2026-09-09', '13:00'), wechat.fetchImpl)).toMatchObject({ due: 2, failed: 2 });
    expect(await prisma.reminderPlan.findFirstOrThrow({ where: { userId: format.user.id } })).toMatchObject({ quota: 2, enabled: true, lastSentDay: null });
    expect(await prisma.reminderPlan.findFirstOrThrow({ where: { userId: other.user.id } })).toMatchObject({ quota: 2, enabled: true, lastSentDay: '2026-09-09' });
    // The 47003 plan stays eligible within the window; the other one is excluded for the rest of the day.
    expect(await tick(shanghai('2026-09-09', '13:05'), wechat.fetchImpl)).toMatchObject({ due: 1 });
    expect(wechat.sent.filter((item) => item.body.touser === 'mini_tick-other')).toHaveLength(1);
  });

  test('a failed access_token request aborts the tick without touching plans or logs', async () => {
    const { user } = await account('tick-no-token');
    await prisma.reminderPlan.create({ data: { userId: user.id, metric: 'bp', enabled: true, time: '14:00', quota: 1 } });
    const wechat = fakeWechat(undefined, { errcode: 40013, errmsg: 'invalid appid' });
    const errors: unknown[] = [];
    const result = await tick(shanghai('2026-09-09', '14:00'), wechat.fetchImpl, { log: { ...silentLog, error: (obj) => errors.push(obj) } });
    expect(result).toMatchObject({ due: 1, sent: 0, failed: 1 });
    expect(wechat.sent).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(await prisma.reminderPlan.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ quota: 1, enabled: true, lastSentDay: null });
    expect(await prisma.reminderLog.count({ where: { userId: user.id } })).toBe(0);
  });

  test('disabled plans, exhausted quota and deactivated users are never due', async () => {
    const disabled = await account('tick-disabled');
    const empty = await account('tick-empty-quota');
    const gone = await account('tick-deactivated');
    await prisma.reminderPlan.create({ data: { userId: disabled.user.id, metric: 'bp', enabled: false, time: '15:00', quota: 3 } });
    await prisma.reminderPlan.create({ data: { userId: empty.user.id, metric: 'bp', enabled: true, time: '15:00', quota: 0 } });
    await prisma.reminderPlan.create({ data: { userId: gone.user.id, metric: 'bp', enabled: true, time: '15:00', quota: 3 } });
    await prisma.user.update({ where: { id: gone.user.id }, data: { deactivatedAt: new Date() } });
    const wechat = fakeWechat();
    expect(await tick(shanghai('2026-09-09', '15:00'), wechat.fetchImpl)).toMatchObject({ due: 0 });
    expect(wechat.sent).toHaveLength(0);
  });
});
