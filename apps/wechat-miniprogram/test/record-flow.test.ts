import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const root = path.resolve(__dirname, '..');

function loadCommonJs(filename: string, requireStub: (id: string) => unknown = () => ({})) {
  const source = fs.readFileSync(filename, 'utf8');
  const cjsModule: { exports: Record<string, unknown> } = { exports: {} };
  const execute = new Function('require', 'module', 'exports', source);
  execute(requireStub, cjsModule, cjsModule.exports);
  return cjsModule.exports;
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

function loadRecordDefinition() {
  const metrics = loadCommonJs(path.join(root, 'utils/metrics.js'));
  const stubs: Record<string, unknown> = {
    '../../utils/api': { getToken: () => '', request: vi.fn() },
    '../../utils/data-cache': {
      captureDataLease: () => ({}),
      isDataLeaseCurrent: () => true,
      isPageFresh: () => false,
      markPageFresh: () => true,
      markRecordsChanged: vi.fn()
    },
    '../../utils/page': { loadMe: vi.fn(async () => null), promptLoginForAction: vi.fn() },
    '../../utils/demo': { demoMe: { unit: 'mmol', sex: 'male' } },
    '../../utils/format': {
      toDateInput,
      toTimeInput,
      toIsoFromInputs: (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString()
    },
    '../../utils/tabbar': {
      consumeRecordMetric: () => '',
      consumeRecordReturnPath: () => '/pages/home/index',
      setRecordReturnPath: vi.fn(),
      syncTabBar: vi.fn()
    },
    '../../utils/metrics': metrics
  };
  const source = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
  let definition: Record<string, any> | undefined;
  const execute = new Function('require', 'Page', source);
  execute((id: string) => {
    if (!(id in stubs)) throw new Error(`Unexpected require: ${id}`);
    return stubs[id];
  }, (page: Record<string, any>) => {
    definition = page;
  });
  if (!definition) throw new Error('Record page definition was not registered');
  return definition;
}

function applySetData(data: Record<string, any>, patch: Record<string, any>) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.');
    if (parts.length === 1) {
      data[key] = value;
      continue;
    }
    const [head, ...tail] = parts;
    const next = { ...(data[head] || {}) };
    let cursor = next;
    for (let index = 0; index < tail.length - 1; index += 1) {
      cursor[tail[index]] = { ...(cursor[tail[index]] || {}) };
      cursor = cursor[tail[index]];
    }
    cursor[tail.at(-1)!] = value;
    data[head] = next;
  }
}

function createRecordPage() {
  const definition = loadRecordDefinition();
  const page: Record<string, any> = {
    ...definition,
    data: structuredClone(definition.data)
  };
  page.setData = (patch: Record<string, any>, callback?: () => void) => {
    applySetData(page.data, patch);
    callback?.();
  };
  page.onLoad();
  return page;
}

describe('wechat record flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T22:30:00+08:00'));
    (globalThis as any).getApp = () => ({ globalData: { navStyle: '' } });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).getApp;
  });

  test('keeps a separate draft for each metric', () => {
    const page = createRecordPage();
    page.setMetricValue('glucose');
    page.setData({ value: '6.8', note: '晚餐后', tags: ['聚餐'] });

    page.setMetricValue('bp');
    page.setData({ sbp: '128', dbp: '82', note: '晨起' });
    page.setMetricValue('glucose');

    expect(page.data.value).toBe('6.8');
    expect(page.data.note).toBe('晚餐后');
    expect(page.data.tags).toEqual(['聚餐']);

    page.setMetricValue('bp');
    expect(page.data.sbp).toBe('128');
    expect(page.data.dbp).toBe('82');
    expect(page.data.note).toBe('晨起');
  });

  test('recommends the period from the selected measurement time and resets manual state after time changes', () => {
    const page = createRecordPage();
    page.setMetricValue('glucose');
    page.setData({ dateValue: '2026-08-21', timeValue: '07:20' });
    page.syncMeasurementTime();
    expect(page.data.period).toBe('fasting');
    expect(page.data.periodHintText).toBe('已按测量时间推荐');

    page.setPeriod({ currentTarget: { dataset: { period: 'after_breakfast' } } });
    expect(page.data.periodWasManuallySelected).toBe(true);
    expect(page.data.periodHintText).toContain('已手动选择');

    page.onInput({ currentTarget: { dataset: { key: 'timeValue' } }, detail: { value: '18:50' } });
    expect(page.data.period).toBe('after_dinner');
    expect(page.data.periodWasManuallySelected).toBe(false);
  });

  test('matches the server numeric boundaries for all four metrics', () => {
    const page = createRecordPage();

    page.data.unitText = 'mmol/L';
    expect(page.glucoseInputValidation('1.1').ok).toBe(true);
    expect(page.glucoseInputValidation('33.3').ok).toBe(true);
    expect(page.glucoseInputValidation('1.0').ok).toBe(false);

    page.data.unitText = 'mg/dL';
    expect(page.glucoseInputValidation('20').ok).toBe(true);
    expect(page.glucoseInputValidation('600').ok).toBe(true);
    expect(page.glucoseInputValidation('20.5').ok).toBe(false);

    page.setData({ sbp: '50', dbp: '30', pulse: '30' });
    expect(page.bpInputValidation().ok).toBe(true);
    page.setData({ sbp: '301', dbp: '80' });
    expect(page.bpInputValidation().ok).toBe(false);

    expect(page.lipidValueValidation('0.1', '总胆固醇').ok).toBe(true);
    expect(page.lipidValueValidation('30', '总胆固醇').ok).toBe(true);
    expect(page.lipidValueValidation('30.1', '总胆固醇').ok).toBe(false);

    expect(page.uricInputValidation('50').ok).toBe(true);
    expect(page.uricInputValidation('1500').ok).toBe(true);
    expect(page.uricInputValidation('49').ok).toBe(false);
  });

  test('does not classify invalid input as a health status', () => {
    const page = createRecordPage();
    page.setMetricValue('glucose');
    page.setData({ value: '0' });
    page.updateLive();

    expect(page.data.inputValid).toBe(false);
    expect(page.data.live.text).toContain('有效范围');
    expect(page.data.live.style).toBe('color:#7A8A85');

    page.setMetricValue('lipid');
    page.setData({ 'lipid.tc': '31' });
    page.updateLipidItems();
    expect(page.data.lipidItems.find((item: any) => item.key === 'tc').statusText).toBe('范围有误');
  });

  test('rejects future measurement times and exposes clear integer-key states', () => {
    const page = createRecordPage();
    expect(page.measurementTimeError('2026-08-21', '22:31')).toBe('测量时间不能晚于现在');
    expect(page.measurementTimeError('2026-08-21', '22:30')).toBe('');

    expect(page.decimalKeyPatch('bp', 'mmol/L')).toMatchObject({ dotKeyText: '下一项', decimalKeyDisabled: false });
    expect(page.decimalKeyPatch('uric', 'μmol/L')).toMatchObject({ dotKeyText: '整数', decimalKeyDisabled: true });
    expect(page.decimalKeyPatch('glucose', 'mg/dL')).toMatchObject({ dotKeyText: '整数', decimalKeyDisabled: true });
  });

  test('shows an explicit saved-value summary and a neutral safety notice', () => {
    const page = createRecordPage();
    page.setData({ dateValue: '2026-08-21', timeValue: '07:30' });

    expect(page.savedRecordPresentation(
      'glucose',
      { value: 6.8, unit: 'mmol' },
      { displayValue: '6.8', displayUnit: 'mmol/L' }
    )).toEqual({ summary: '血糖 6.8 mmol/L', timeText: '2026-08-21 07:30' });
    expect(page.safetyNotice('high')).toContain('明显偏高');
    expect(page.safetyNotice(null)).toBe('');
  });
});
