import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const root = path.resolve(__dirname, '..');
const GLUCOSE_TMPL = 'tmpl-glucose';
const BP_TMPL = 'tmpl-bp';
const TEMPLATES = { glucose: GLUCOSE_TMPL, bp: BP_TMPL };

function loadCommonJs(filename: string, requireStub: (id: string) => unknown = () => ({})) {
  const source = fs.readFileSync(filename, 'utf8');
  const cjsModule: { exports: Record<string, any> } = { exports: {} };
  new Function('require', 'module', 'exports', source)(requireStub, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const metrics = loadCommonJs(path.join(root, 'utils/metrics.js'));

function loadReminderUtils(api: { getToken: () => string; request: (...args: any[]) => any }) {
  return loadCommonJs(path.join(root, 'utils/reminders.js'), (id: string) => {
    if (id === './api') return api;
    if (id === './metrics') return metrics;
    throw new Error(`Unexpected require: ${id}`);
  });
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateInput(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function installWx(extra: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>();
  (globalThis as any).getApp = () => ({ globalData: { navStyle: '' } });
  (globalThis as any).wx = {
    getStorageSync: vi.fn((key: string) => structuredClone(storage.get(key))),
    setStorageSync: vi.fn((key: string, value: unknown) => storage.set(key, structuredClone(value))),
    removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    showModal: vi.fn(),
    showToast: vi.fn(),
    switchTab: vi.fn(),
    ...extra
  };
  return storage;
}

// Mirrors record-flow.test.ts but shares one API stub between the page and the
// real reminders module so the whole save → offer → enable flow is exercised.
function createRecordPage(options: {
  api: { getToken: () => string; request: (...args: any[]) => any };
  me?: Record<string, unknown> | null;
  navigationIntent?: { recordMetric: string };
}) {
  const intent = options.navigationIntent || { recordMetric: '' };
  const reminders = loadReminderUtils(options.api);
  const stubs: Record<string, unknown> = {
    '../../utils/api': options.api,
    '../../utils/data-cache': {
      captureDataLease: () => ({}),
      isDataLeaseCurrent: () => true,
      isPageFresh: () => false,
      markPageFresh: () => true,
      markRecordsChanged: vi.fn()
    },
    '../../utils/page': {
      loadMe: async () => options.me ?? null,
      promptLoginForAction: vi.fn(),
      handleRequestError: () => false,
      friendlyErrorMessage: (error: any, fallback: string) => error.message || fallback
    },
    '../../utils/demo': { demoMe: { unit: 'mmol', sex: 'male' } },
    '../../utils/record-draft': loadCommonJs(path.join(root, 'utils/record-draft.js')),
    '../../utils/format': { toDateInput, toTimeInput },
    '../../utils/tabbar': {
      consumeRecordMetric: () => {
        const metric = intent.recordMetric;
        intent.recordMetric = '';
        return metric;
      },
      consumeRecordEdit: () => null,
      consumeRecordReturnPath: () => '/pages/home/index',
      setRecordMetric: (metric: string) => { intent.recordMetric = metric; },
      setRecordReturnPath: vi.fn(),
      syncTabBar: vi.fn()
    },
    '../../utils/reminders': reminders,
    '../../utils/metrics': metrics
  };
  let definition: Record<string, any> | undefined;
  new Function('require', 'Page', fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8'))(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`Unexpected require: ${id}`);
      return stubs[id];
    },
    (page: Record<string, any>) => { definition = page; }
  );
  if (!definition) throw new Error('Record page definition was not registered');
  const page: Record<string, any> = { ...definition, data: structuredClone(definition.data) };
  page.setData = (patch: Record<string, any>, callback?: () => void) => {
    for (const [key, value] of Object.entries(patch)) {
      if (key.includes('.')) {
        const [head, ...tail] = key.split('.');
        const next = { ...(page.data[head] || {}) };
        next[tail.join('.')] = value;
        page.data[head] = next;
      } else {
        page.data[key] = value;
      }
    }
    callback?.();
  };
  return { page, reminders };
}

function remindersApi(state: { plans: any[]; templates: Record<string, string> }) {
  const request = vi.fn(async (url: string, options: any = {}) => {
    if (url === '/api/app/reminders') return state;
    if (url === '/api/app/reminders/subscriptions') return { plans: state.plans };
    if (url.startsWith('/api/app/reminders/')) {
      return { plan: { metric: url.split('/').pop(), ...options.data, quota: 0 } };
    }
    return {};
  });
  return { getToken: () => 'token-a', request };
}

describe('reminder subscription helpers', () => {
  beforeEach(() => { installWx(); });
  afterEach(() => {
    delete (globalThis as any).wx;
    delete (globalThis as any).getApp;
  });

  test('maps accepted template ids back to metrics and calls WeChat synchronously', async () => {
    const requestSubscribeMessage = vi.fn((options: any) => {
      options.success({ errMsg: 'requestSubscribeMessage:ok', [GLUCOSE_TMPL]: 'accept', [BP_TMPL]: 'reject' });
    });
    (globalThis as any).wx.requestSubscribeMessage = requestSubscribeMessage;
    const { requestSubscribe } = loadReminderUtils({ getToken: () => 'token-a', request: vi.fn() });

    const pending = requestSubscribe(TEMPLATES, ['glucose', 'bp']);
    expect(requestSubscribeMessage).toHaveBeenCalledTimes(1);
    expect(requestSubscribeMessage.mock.calls[0][0].tmplIds).toEqual([GLUCOSE_TMPL, BP_TMPL]);
    await expect(pending).resolves.toEqual({ accepted: ['glucose'] });
  });

  test('normalises reject, ban, failure and a missing API to an empty accepted list', async () => {
    const { requestSubscribe } = loadReminderUtils({ getToken: () => 'token-a', request: vi.fn() });

    (globalThis as any).wx.requestSubscribeMessage = (options: any) => options.success({ [GLUCOSE_TMPL]: 'reject', [BP_TMPL]: 'ban' });
    await expect(requestSubscribe(TEMPLATES, ['glucose', 'bp'])).resolves.toEqual({ accepted: [] });

    (globalThis as any).wx.requestSubscribeMessage = (options: any) => options.fail({ errCode: 20004, errMsg: 'user refuse' });
    await expect(requestSubscribe(TEMPLATES, ['glucose'])).resolves.toEqual({ accepted: [] });

    (globalThis as any).wx.requestSubscribeMessage = () => { throw new Error('can only be invoked by user TAP gesture'); };
    await expect(requestSubscribe(TEMPLATES, ['glucose'])).resolves.toEqual({ accepted: [] });

    delete (globalThis as any).wx.requestSubscribeMessage;
    await expect(requestSubscribe(TEMPLATES, ['glucose'])).resolves.toEqual({ accepted: [] });

    (globalThis as any).wx.requestSubscribeMessage = vi.fn();
    await expect(requestSubscribe({}, ['glucose'])).resolves.toEqual({ accepted: [] });
    expect((globalThis as any).wx.requestSubscribeMessage).not.toHaveBeenCalled();
  });

  test('reports only accepted metrics, skips empty results and swallows failures', async () => {
    const request = vi.fn().mockResolvedValueOnce({ plans: [] }).mockRejectedValueOnce(new Error('网络异常'));
    const { reportSubscriptions } = loadReminderUtils({ getToken: () => 'token-a', request });

    await reportSubscriptions(['glucose', 'lipid']);
    expect(request).toHaveBeenCalledWith('/api/app/reminders/subscriptions', { method: 'POST', data: { accepted: ['glucose'] } });
    await expect(reportSubscriptions(['bp'])).resolves.toBeNull();
    await reportSubscriptions([]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('caches the reminder state until a plan is saved', async () => {
    const api = remindersApi({ plans: [{ metric: 'bp', enabled: true, time: '07:30', quota: 2 }], templates: TEMPLATES });
    const { loadReminders, savePlan, planFor } = loadReminderUtils(api);

    const first = await loadReminders();
    const second = await loadReminders();
    expect(second).toBe(first);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(first.plans.map((plan: any) => plan.metric)).toEqual(['glucose', 'bp']);
    expect(planFor(first, 'glucose')).toMatchObject({ enabled: false, time: '07:00', period: 'fasting', quota: 0 });
    expect(planFor(first, 'bp')).toMatchObject({ enabled: true, time: '07:30', period: null, quota: 2 });

    await savePlan('bp', { enabled: false, time: '07:30' });
    expect(api.request).toHaveBeenLastCalledWith('/api/app/reminders/bp', { method: 'PUT', data: { enabled: false, time: '07:30' } });
    await loadReminders();
    expect(api.request.mock.calls.filter((call) => call[0] === '/api/app/reminders')).toHaveLength(2);
  });

  test('summarises enabled plans and rounds record times to five minutes', () => {
    const { planSummary, roundToFiveMinutes } = loadReminderUtils({ getToken: () => '', request: vi.fn() });

    expect(planSummary([
      { metric: 'glucose', enabled: true, time: '07:00' },
      { metric: 'bp', enabled: true, time: '07:30' }
    ])).toBe('血糖 07:00 · 血压 07:30');
    expect(planSummary([{ metric: 'bp', enabled: true, time: '21:00' }])).toBe('血压 21:00');
    expect(planSummary([])).toBe('未开启');
    expect(planSummary(undefined)).toBe('未开启');

    expect(roundToFiveMinutes('07:03')).toBe('07:05');
    expect(roundToFiveMinutes('07:02')).toBe('07:00');
    expect(roundToFiveMinutes('07:58')).toBe('08:00');
    expect(roundToFiveMinutes('23:58')).toBe('00:00');
    expect(roundToFiveMinutes('bad')).toBe('07:00');
    expect(roundToFiveMinutes('', '07:30')).toBe('07:30');
  });

  test('remembers "以后再说" per metric on this device', () => {
    const { dismissOffer, wasOfferDismissed } = loadReminderUtils({ getToken: () => '', request: vi.fn() });

    expect(wasOfferDismissed('glucose')).toBe(false);
    dismissOffer('glucose');
    expect(wasOfferDismissed('glucose')).toBe(true);
    expect(wasOfferDismissed('bp')).toBe(false);

    (globalThis as any).wx.getStorageSync = () => { throw new Error('storage unavailable'); };
    (globalThis as any).wx.setStorageSync = () => { throw new Error('storage unavailable'); };
    expect(() => dismissOffer('bp')).not.toThrow();
    expect(wasOfferDismissed('bp')).toBe(false);
  });
});

describe('record page reminder flow', () => {
  beforeEach(() => { installWx(); });
  afterEach(() => {
    delete (globalThis as any).wx;
    delete (globalThis as any).getApp;
  });

  test('preselects the metric and period from a subscribe message deep link', async () => {
    const { page } = createRecordPage({ api: { getToken: () => '', request: vi.fn() } });
    page.onLoad({ metric: 'bp', period: 'evening', from: 'reminder' });
    await page.onShow();

    expect(page.data.metric).toBe('bp');
    expect(page.data.period).toBe('evening');
    expect(page.data.periodWasManuallySelected).toBe(true);
    expect(page.data.bpPeriods.find((item: any) => item.key === 'evening').className).toBe('on');
  });

  test('ignores an unknown period or metric in the deep link', async () => {
    const { page } = createRecordPage({ api: { getToken: () => '', request: vi.fn() } });
    page.onLoad({ metric: 'glucose', period: 'not-a-period' });
    await page.onShow();
    expect(page.data.metric).toBe('glucose');
    expect(page.data.periodWasManuallySelected).toBe(false);

    const other = createRecordPage({ api: { getToken: () => '', request: vi.fn() } }).page;
    other.onLoad({ metric: 'weight', period: 'fasting' });
    await other.onShow();
    expect(other.data.metric).toBe('glucose');
  });

  test('shows the offer banner after the first glucose save and enables the plan from it', async () => {
    const requestSubscribeMessage = vi.fn((options: any) => options.success({ [GLUCOSE_TMPL]: 'accept', [BP_TMPL]: 'accept' }));
    (globalThis as any).wx.requestSubscribeMessage = requestSubscribeMessage;
    const api = remindersApi({ plans: [], templates: TEMPLATES });
    const { page } = createRecordPage({ api, me: { id: 'user-a', unit: 'mmol' } });
    page.onLoad();
    await page.onShow();
    await page.syncReminderState();

    page.onInput({ currentTarget: { dataset: { key: 'dateValue' } }, detail: { value: '2026-08-21' } });
    page.onInput({ currentTarget: { dataset: { key: 'timeValue' } }, detail: { value: '07:03' } });
    page.setData({ value: '6.8' });
    await page.save();

    // No plan is enabled yet, so saving must not open the subscription dialog.
    expect(requestSubscribeMessage).not.toHaveBeenCalled();
    expect(api.request).toHaveBeenCalledWith('/api/app/records/glucose', expect.objectContaining({ method: 'POST' }));
    expect(page.data.reminderOffer).toMatchObject({
      metric: 'glucose',
      time: '07:05',
      period: 'fasting',
      question: '要不要每天这个时候提醒您测血糖？',
      done: false
    });

    await page.enableReminderOffer();
    expect(requestSubscribeMessage).toHaveBeenCalledTimes(1);
    expect(requestSubscribeMessage.mock.calls[0][0].tmplIds).toEqual([GLUCOSE_TMPL, BP_TMPL]);
    expect(api.request).toHaveBeenCalledWith('/api/app/reminders/glucose', {
      method: 'PUT', data: { enabled: true, time: '07:05', period: 'fasting' }
    });
    expect(api.request).toHaveBeenCalledWith('/api/app/reminders/subscriptions', {
      method: 'POST', data: { accepted: ['glucose', 'bp'] }
    });
    expect(page.data.reminderOffer.done).toBe(true);
    expect(page.data.reminderOffer.doneText).toBe('每天 07:05 提醒您测空腹血糖。可在「我的 → 测量提醒」修改');
    expect(page.data.reminderOfferBusy).toBe(false);
  });

  test('does not offer again after "以后再说", when the plan is enabled, or without templates', async () => {
    const saveGlucose = async (api: ReturnType<typeof remindersApi>) => {
      const { page } = createRecordPage({ api, me: { id: 'user-a', unit: 'mmol' } });
      page.onLoad();
      await page.onShow();
      await page.syncReminderState();
      page.onInput({ currentTarget: { dataset: { key: 'dateValue' } }, detail: { value: '2026-08-21' } });
      page.onInput({ currentTarget: { dataset: { key: 'timeValue' } }, detail: { value: '07:03' } });
      page.setData({ value: '6.8' });
      await page.save();
      return page;
    };

    const dismissed = await saveGlucose(remindersApi({ plans: [], templates: TEMPLATES }));
    expect(dismissed.data.reminderOffer).not.toBeNull();
    dismissed.dismissReminderOffer();
    expect(dismissed.data.reminderOffer).toBeNull();
    expect((globalThis as any).wx.getStorageSync('tangji_reminder_offer_dismissed')).toEqual({ glucose: true });
    const again = await saveGlucose(remindersApi({ plans: [], templates: TEMPLATES }));
    expect(again.data.reminderOffer).toBeNull();

    (globalThis as any).wx.removeStorageSync('tangji_reminder_offer_dismissed');
    const enabled = await saveGlucose(remindersApi({
      plans: [{ metric: 'glucose', enabled: true, time: '07:00', period: 'fasting', quota: 3 }],
      templates: TEMPLATES
    }));
    expect(enabled.data.reminderOffer).toBeNull();

    const noTemplates = await saveGlucose(remindersApi({ plans: [], templates: {} }));
    expect(noTemplates.data.reminderOffer).toBeNull();
  });

  test('requests quota for enabled plans at the start of save() and reports accepted ones afterwards', async () => {
    const calls: string[] = [];
    const requestSubscribeMessage = vi.fn((options: any) => {
      calls.push('subscribe');
      options.success({ [GLUCOSE_TMPL]: 'accept' });
    });
    (globalThis as any).wx.requestSubscribeMessage = requestSubscribeMessage;
    const api = remindersApi({
      plans: [
        { metric: 'glucose', enabled: true, time: '07:00', period: 'fasting', quota: 0 },
        { metric: 'bp', enabled: false, time: '07:30', quota: 0 }
      ],
      templates: TEMPLATES
    });
    const request = api.request;
    api.request = vi.fn(async (url: string, options: any) => {
      calls.push(url);
      return request(url, options);
    }) as any;
    const { page } = createRecordPage({ api, me: { id: 'user-a', unit: 'mmol' } });
    page.onLoad();
    await page.onShow();
    await page.syncReminderState();

    page.onInput({ currentTarget: { dataset: { key: 'dateValue' } }, detail: { value: '2026-08-21' } });
    page.onInput({ currentTarget: { dataset: { key: 'timeValue' } }, detail: { value: '07:03' } });
    page.setData({ value: '6.8' });
    await page.save();
    await Promise.resolve();

    expect(requestSubscribeMessage.mock.calls[0][0].tmplIds).toEqual([GLUCOSE_TMPL]);
    expect(calls.indexOf('subscribe')).toBeLessThan(calls.indexOf('/api/app/records/glucose'));
    expect(calls).toContain('/api/app/reminders/subscriptions');
    expect(page.data.reminderOffer).toBeNull();
    expect(page.data.saving).toBe(false);
  });
});
