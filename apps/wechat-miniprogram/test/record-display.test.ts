import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const root = path.resolve(__dirname, '..');

function cjs(relative: string) {
  const module = { exports: {} as Record<string, any> };
  new Function('module', 'exports', fs.readFileSync(path.join(root, relative), 'utf8'))(module, module.exports);
  return module.exports;
}

function pageFor(name: string, overrides: Record<string, unknown> = {}) {
  const metrics = cjs('utils/metrics.js');
  const format = cjs('utils/format.js');
  const stubs: Record<string, any> = {
    '../../utils/api': { getToken: () => 'token-a', request: vi.fn() },
    '../../utils/page': {
      ensureLogin: async () => true,
      fetchMe: async () => ({ id: 'user-a', unit: 'mmol' }),
      decorateRecord: (metric: string, record: object) => ({ metric, ...record }),
      handleRequestError: () => false,
      friendlyErrorMessage: (error: any, fallback: string) => error.message || fallback
    },
    '../../utils/data-cache': {
      captureDataLease: () => ({ generation: 0, versions: { records: 0, profile: 0 } }),
      isDataLeaseCurrent: () => true,
      isPageFresh: () => false,
      markPageFresh: vi.fn(),
      markRecordsChanged: vi.fn()
    },
    '../../utils/tabbar': { syncTabBar: vi.fn(), setRecordEdit: vi.fn(), setRecordReturnPath: vi.fn() },
    '../../utils/record-draft': cjs('utils/record-draft.js'),
    '../../utils/avatar': {},
    '../../utils/privacy': {},
    '../../utils/demo': {},
    '../../utils/metrics': metrics,
    '../../utils/format': format,
    ...overrides
  };
  let definition: any;
  new Function('require', 'Page', fs.readFileSync(path.join(root, `pages/${name}/index.js`), 'utf8'))(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`Unexpected require: ${id}`);
      return stubs[id];
    }, (value: unknown) => { definition = value; }
  );
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = (updates: object, callback?: () => void) => { Object.assign(page.data, updates); callback?.(); };
  return page;
}

describe('record presentation and history recovery', () => {
  beforeEach(() => {
    (globalThis as any).wx = { showToast: vi.fn(), showModal: vi.fn(), switchTab: vi.fn() };
  });

  afterEach(() => { delete (globalThis as any).wx; });

  test('uses the measured period and user’s display unit for both the value and reference band', () => {
    const page = pageFor('home');
    const entry = { latest: { valueMmol: 7.8, period: 'fasting', measuredAt: '2026-08-21T07:30:00+08:00', status: { key: 'ok', label: '达标' } } };
    const fasting = page.decorateMetric({ key: 'glucose', name: '血糖' }, entry, {
      unit: 'mmol', target: { fastingLow: 4.4, fastingHigh: 7, postMealHigh: 10 }
    });
    expect(fasting.statusLabel).toBe('偏高');
    expect(fasting.targetText).toBe('空腹参考 4.4–7.0 mmol/L');
    expect(parseFloat(fasting.dotLeft)).toBeGreaterThan(parseFloat(fasting.bandLeft) + parseFloat(fasting.bandWidth));
    expect(fasting.dateText).toContain('2026-08-21');

    const afterMeal = page.decorateMetric({ key: 'glucose', name: '血糖' }, {
      latest: { ...entry.latest, period: 'post_meal_2h' }
    }, { unit: 'mgdl', target: { fastingLow: 4.4, fastingHigh: 7, postMealHigh: 10 } });
    expect(afterMeal.statusLabel).toBe('达标');
    expect(afterMeal.valueText).toBe('140');
    expect(afterMeal.targetText).toBe('餐后2小时参考 79–180 mg/dL');
    expect(afterMeal.gaugeMaxText).toBe('360');
    expect(parseFloat(afterMeal.dotLeft)).toBeLessThan(parseFloat(afterMeal.bandLeft) + parseFloat(afterMeal.bandWidth));
  });

  test('clears the previous metric immediately and allows recovery after loading fails', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce({ items: [{ id: 'bp-1', sbp: 128, dbp: 82 }] });
    const page = pageFor('history', { '../../utils/api': { getToken: () => 'token-a', request } });
    page.setData({ authed: true, records: [{ id: 'old-glucose', valueMmol: 6.8 }], hasRecords: true });
    let loadPromise: Promise<void>;
    const load = page.load.bind(page);
    page.load = (...args: any[]) => { loadPromise = load(...args); return loadPromise; };
    page.setMetric({ currentTarget: { dataset: { metric: 'bp' } } });
    expect(page.data.records).toEqual([]);
    expect(page.data.loading).toBe(true);
    await loadPromise!;
    expect(page.data.error).toBe('网络不可用');
    expect(page.data.records).toEqual([]);
    page.retry();
    await loadPromise!;
    expect(page.data.error).toBe('');
    expect(page.data.records).toEqual([{ metric: 'bp', id: 'bp-1', sbp: 128, dbp: 82 }]);
  });

  test('ignores an older metric response that arrives after the selected metric has loaded', async () => {
    let resolveGlucose: (value: unknown) => void = () => {};
    const request = vi.fn((url: string) => url.includes('/glucose')
      ? new Promise((resolve) => { resolveGlucose = resolve; })
      : Promise.resolve({ items: [{ id: 'bp-1', sbp: 120, dbp: 80 }] }));
    const page = pageFor('history', { '../../utils/api': { getToken: () => 'token-a', request } });
    const first = page.load();
    await Promise.resolve();
    page.setData({ metric: 'bp' });
    await page.load();
    resolveGlucose({ items: [{ id: 'old-glucose', valueMmol: 6.8 }] });
    await first;
    expect(page.data.metric).toBe('bp');
    expect(page.data.records.map((record: any) => record.id)).toEqual(['bp-1']);
  });

  test('does not reuse a history edit intent after a different account signs in', () => {
    const tabbar = cjs('utils/tabbar.js');
    tabbar.setRecordEdit('glucose', { id: 'record-a', valueMmol: 6.8 }, 'token-a');
    expect(tabbar.consumeRecordEdit('token-b')).toBeNull();
    expect(tabbar.consumeRecordEdit('token-a')).toBeNull();
  });

  test('retries a guest record after login with the persisted key, and clears it only after success', async () => {
    let pending: any = { metric: 'glucose', data: { value: 6.8, unit: 'mmol', period: 'fasting', measuredAt: '2026-08-21T07:30:00+08:00' } };
    const request = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({});
    const clearPendingRecord = vi.fn(() => { pending = null; });
    (globalThis as any).wx.setStorageSync = vi.fn((key: string, value: unknown) => {
      if (key === 'tangji_pending_record') pending = structuredClone(value);
    });
    (globalThis as any).wx.getStorageSync = vi.fn();
    (globalThis as any).wx.removeStorageSync = vi.fn();
    const page = pageFor('home', {
      '../../utils/api': { getToken: () => 'token-a', request },
      '../../utils/page': { getPendingRecord: () => pending, clearPendingRecord }
    });
    page.setData({ authed: true, me: { id: 'user-a', unit: 'mmol' } });
    page.refresh = vi.fn(async () => ({}));
    await page.savePendingRecord();
    const key = pending.clientRequestId;
    expect(key).toBeTruthy();
    expect(pending.ownerId).toBe('user-a');
    expect(clearPendingRecord).not.toHaveBeenCalled();
    await page.savePendingRecord();
    expect(request.mock.calls.map((call) => call[1].header['Idempotency-Key'])).toEqual([key, key]);
    expect(clearPendingRecord).toHaveBeenCalledTimes(1);
  });
});

describe('local record draft retention', () => {
  afterEach(() => { vi.useRealTimers(); delete (globalThis as any).wx; });

  test('expires retained health values after seven days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    const storage = new Map<string, any>();
    (globalThis as any).wx = {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key)
    };
    const drafts = cjs('utils/record-draft.js');
    drafts.writeRecordDrafts('user-a', { glucose: { value: '6.8' } });
    expect(drafts.readRecordDrafts('user-a')).toHaveProperty('glucose');
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    expect(drafts.readRecordDrafts('user-a')).toEqual({});
    expect(storage.size).toBe(0);
  });
});
