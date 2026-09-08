import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const root = path.resolve(__dirname, '..');
const MEDICATION_TMPL = 'tmpl-medication';

function loadCommonJs(filename: string, requireStub: (id: string) => unknown = () => ({})) {
  const source = fs.readFileSync(filename, 'utf8');
  const cjsModule: { exports: Record<string, any> } = { exports: {} };
  new Function('require', 'module', 'exports', source)(requireStub, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

// Resolves relative requires against the real utils so weekly-report.js loads
// with its metrics / stats-view dependencies.
function commonJs(file: string): any {
  const filename = path.join(root, file);
  return loadCommonJs(filename, (id: string) => commonJs(path.relative(root, path.resolve(path.dirname(filename), `${id}.js`))));
}

const metrics = loadCommonJs(path.join(root, 'utils/metrics.js'));

type Api = { getToken: () => string; request: ReturnType<typeof vi.fn> };

function loadMedicationUtils(api: Api) {
  return loadCommonJs(path.join(root, 'utils/medications.js'), (id: string) => {
    if (id === './api') return api;
    throw new Error(`Unexpected require: ${id}`);
  });
}

function loadReminderUtils(api: Api) {
  return loadCommonJs(path.join(root, 'utils/reminders.js'), (id: string) => {
    if (id === './api') return api;
    if (id === './metrics') return metrics;
    throw new Error(`Unexpected require: ${id}`);
  });
}

type Medication = { id: string; name: string; times: string[] };
type ServerState = { medications: Medication[]; taken: Set<string>; reminder: { enabled: boolean; quota: number }; template?: string; day: string };

function todayFor(state: ServerState) {
  const slots = new Map<string, Array<{ medicationId: string; name: string; taken: boolean }>>();
  for (const medication of state.medications) {
    for (const time of medication.times) {
      if (!slots.has(time)) slots.set(time, []);
      slots.get(time)!.push({ medicationId: medication.id, name: medication.name, taken: state.taken.has(`${time}:${medication.id}`) });
    }
  }
  return { day: state.day, slots: Array.from(slots.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([time, items]) => ({ time, items })) };
}

// In-memory stand-in for the API contract in docs/WECHAT-MEDICATION-SPEC.md §5.
function medicationsApi(state: ServerState, calls: string[] = []): Api {
  let seq = state.medications.length;
  const request = vi.fn(async (url: string, options: any = {}) => {
    const method = String(options.method || 'GET');
    calls.push(`${method} ${url}`);
    if (url === '/api/app/medications' && method === 'GET') {
      return { medications: state.medications, today: todayFor(state), reminder: state.reminder, template: state.template };
    }
    if (url === '/api/app/medications' && method === 'POST') {
      if (state.medications.length >= 8) {
        const error: any = new Error('常用药最多 8 种');
        error.statusCode = 422;
        error.code = 'MEDICATION_LIMIT';
        throw error;
      }
      seq += 1;
      const medication = { id: `m${seq}`, ...options.data };
      state.medications.push(medication);
      return { medication };
    }
    if (url === '/api/app/medications/checkins') {
      if (options.data.day !== state.day) {
        const error: any = new Error('只能记录今天');
        error.statusCode = 422;
        throw error;
      }
      const key = `${options.data.slot}:${options.data.medicationId}`;
      if (options.data.taken) state.taken.add(key);
      else state.taken.delete(key);
      return { today: todayFor(state) };
    }
    if (url.startsWith('/api/app/medications/') && method === 'PATCH') {
      const id = decodeURIComponent(url.split('/').pop()!);
      const medication = state.medications.find((item) => item.id === id)!;
      Object.assign(medication, options.data);
      return { medication };
    }
    if (url.startsWith('/api/app/medications/') && method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').pop()!);
      state.medications = state.medications.filter((item) => item.id !== id);
      return null;
    }
    if (url === '/api/app/reminders/medication') {
      state.reminder = { enabled: Boolean(options.data.enabled), quota: state.reminder.quota };
      return { plan: { metric: 'medication', ...state.reminder } };
    }
    if (url === '/api/app/reminders/subscriptions') return { plans: [] };
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  return { getToken: () => 'token-a', request };
}

function installWx(extra: Record<string, unknown> = {}) {
  (globalThis as any).getApp = () => ({ globalData: { navStyle: '' } });
  (globalThis as any).wx = {
    getStorageSync: vi.fn(() => undefined),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    showModal: vi.fn(),
    showToast: vi.fn(),
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    switchTab: vi.fn(),
    ...extra
  };
}

function createMedicationsPage(api: Api) {
  const stubs: Record<string, unknown> = {
    '../../utils/api': api,
    '../../utils/data-cache': { captureDataLease: () => ({}), isDataLeaseCurrent: () => true },
    '../../utils/page': {
      doLogin: vi.fn(),
      ensureLogin: async () => true,
      handleRequestError: () => false,
      friendlyErrorMessage: (error: any, fallback: string) => error.message || fallback
    },
    '../../utils/medications': loadMedicationUtils(api),
    '../../utils/reminders': loadReminderUtils(api)
  };
  let definition: Record<string, any> | undefined;
  new Function('require', 'Page', fs.readFileSync(path.join(root, 'pages/medications/index.js'), 'utf8'))(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`Unexpected require: ${id}`);
      return stubs[id];
    },
    (page: Record<string, any>) => { definition = page; }
  );
  if (!definition) throw new Error('Medications page definition was not registered');
  const page: Record<string, any> = { ...definition, data: structuredClone(definition.data) };
  page.setData = (patch: Record<string, any>, callback?: () => void) => {
    Object.assign(page.data, patch);
    callback?.();
  };
  return page;
}

function tap(dataset: Record<string, unknown>) {
  return { currentTarget: { dataset } };
}

function serverState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    medications: [
      { id: 'm1', name: '二甲双胍', times: ['08:00', '20:00'] },
      { id: 'm2', name: '阿卡波糖', times: ['08:00'] }
    ],
    taken: new Set(),
    reminder: { enabled: true, quota: 2 },
    template: MEDICATION_TMPL,
    day: '2026-09-08',
    ...overrides
  };
}

describe('medication helpers', () => {
  const utils = loadMedicationUtils({ getToken: () => '', request: vi.fn() });

  test('validates the name after trimming to 1–20 characters', () => {
    expect(utils.validateName('  二甲双胍 ')).toEqual({ ok: true, value: '二甲双胍', message: '' });
    expect(utils.validateName('   ').ok).toBe(false);
    expect(utils.validateName(undefined).ok).toBe(false);
    expect(utils.validateName('一'.repeat(20)).ok).toBe(true);
    expect(utils.validateName('一'.repeat(21))).toMatchObject({ ok: false, message: '药名最多 20 个字' });
  });

  test('keeps 1–4 valid HH:mm times, de-duplicated and sorted', () => {
    expect(utils.normalizeTimes(['20:00', '08:00', '08:00', ' 12:30 '])).toEqual(['08:00', '12:30', '20:00']);
    expect(utils.normalizeTimes(['8:00', '24:00', '12:60', 'x', null])).toEqual([]);
    expect(utils.normalizeTimes(['06:00', '07:00', '08:00', '09:00', '10:00'])).toEqual(['06:00', '07:00', '08:00', '09:00']);
    expect(utils.normalizeTimes(undefined)).toEqual([]);
  });

  test('counts untaken items today and summarises the list', () => {
    const today = {
      day: '2026-09-08',
      slots: [
        { time: '08:00', items: [{ medicationId: 'm1', name: 'A', taken: true }, { medicationId: 'm2', name: 'B', taken: false }] },
        { time: '20:00', items: [{ medicationId: 'm1', name: 'A', taken: false }] }
      ]
    };
    expect(utils.pendingCount(today)).toBe(2);
    expect(utils.pendingCount({ day: '', slots: [] })).toBe(0);
    expect(utils.pendingCount(undefined)).toBe(0);
    expect(utils.medicationSummary([{ id: 'a', name: 'A', times: ['08:00'] }, { id: 'b', name: 'B', times: [] }])).toBe('2 种');
    expect(utils.medicationSummary([])).toBe('未添加');
    expect(utils.medicationSummary(undefined)).toBe('未添加');
    expect(utils.slotId('08:00')).toBe('slot-0800');
    expect(utils.slotId('bad')).toBe('');
    expect(utils.MEDICATION_LIMIT_MESSAGE).toBe('常用药最多 8 种');
    expect(utils.FOOTER_TEXT).toBe('用药请遵医嘱，本功能只帮您记录和提醒。');
  });

  test('caches the list per token and drops it after writes', async () => {
    const state = serverState();
    const api = medicationsApi(state);
    const { loadMedications, saveMedication, removeMedication, checkin } = loadMedicationUtils(api);

    const first = await loadMedications();
    expect(await loadMedications()).toBe(first);
    expect(first.today.slots.map((slot: any) => slot.time)).toEqual(['08:00', '20:00']);
    expect(first.template).toBe(MEDICATION_TMPL);
    expect(api.request).toHaveBeenCalledTimes(1);

    await saveMedication('', { name: ' 格列美脲 ', times: ['12:00', '12:00'] });
    expect(api.request).toHaveBeenLastCalledWith('/api/app/medications', { method: 'POST', data: { name: '格列美脲', times: ['12:00'] } });
    await loadMedications();
    expect(api.request.mock.calls.filter((call) => call[0] === '/api/app/medications' && !call[1]).length).toBe(2);

    await expect(saveMedication('', { name: '', times: ['08:00'] })).rejects.toThrow('请填写药名');
    await expect(saveMedication('m1', { name: 'A', times: [] })).rejects.toThrow('请选择每天什么时候吃');

    const today = await checkin({ day: state.day, slot: '08:00', medicationId: 'm1', taken: true });
    expect(today.slots[0].items[0].taken).toBe(true);
    expect((await loadMedications()).today.slots[0].items[0].taken).toBe(true);

    await removeMedication('m2');
    expect(api.request).toHaveBeenLastCalledWith('/api/app/medications/m2', { method: 'DELETE' });
    expect((await loadMedications()).medications.map((item: any) => item.id)).toEqual(['m1', 'm3']);
  });
});

describe('medications page', () => {
  beforeEach(() => { installWx(); });
  afterEach(() => {
    delete (globalThis as any).wx;
    delete (globalThis as any).getApp;
  });

  test('toggles 吃了吗？ ↔ 已吃 and opens the subscribe dialog synchronously before the check-in request', async () => {
    const calls: string[] = [];
    const requestSubscribeMessage = vi.fn((options: any) => {
      calls.push('subscribe');
      options.success({ [MEDICATION_TMPL]: 'accept' });
    });
    (globalThis as any).wx.requestSubscribeMessage = requestSubscribeMessage;
    const state = serverState();
    const api = medicationsApi(state, calls);
    const page = createMedicationsPage(api);
    page.onLoad({});
    await page.onShow();

    expect(page.data.hasMedications).toBe(true);
    expect(page.data.day).toBe('2026-09-08');
    expect(page.data.slots.map((slot: any) => slot.id)).toEqual(['slot-0800', 'slot-2000']);
    expect(page.data.slots[0].items[0]).toMatchObject({ taken: false, stateText: '吃了吗？', stateClass: '' });
    expect(page.data.medications.map((item: any) => item.timesText)).toEqual(['08:00　20:00', '08:00']);
    expect(page.data.reminderNote).toBe('到点会按这些时间提醒您，全部打勾后就不再提醒。');

    await page.toggleTaken(tap({ slot: '08:00', id: 'm1' }));
    expect(requestSubscribeMessage).toHaveBeenCalledTimes(1);
    expect(requestSubscribeMessage.mock.calls[0][0].tmplIds).toEqual([MEDICATION_TMPL]);
    expect(calls.indexOf('subscribe')).toBeLessThan(calls.indexOf('POST /api/app/medications/checkins'));
    expect(api.request).toHaveBeenCalledWith('/api/app/medications/checkins', {
      method: 'POST', data: { day: '2026-09-08', slot: '08:00', medicationId: 'm1', taken: true }
    });
    expect(api.request).toHaveBeenCalledWith('/api/app/reminders/subscriptions', { method: 'POST', data: { accepted: ['medication'] } });
    expect(page.data.slots[0].items[0]).toMatchObject({ taken: true, stateText: '已吃', stateClass: 'on', stateIcon: '✓' });
    expect(page.data.slots[0].items[1].taken).toBe(false);
    expect(page.data.busyKey).toBe('');

    // Second tap undoes a mistaken tick.
    await page.toggleTaken(tap({ slot: '08:00', id: 'm1' }));
    expect(api.request).toHaveBeenLastCalledWith('/api/app/reminders/subscriptions', expect.anything());
    expect(api.request).toHaveBeenCalledWith('/api/app/medications/checkins', {
      method: 'POST', data: { day: '2026-09-08', slot: '08:00', medicationId: 'm1', taken: false }
    });
    expect(page.data.slots[0].items[0]).toMatchObject({ taken: false, stateText: '吃了吗？' });
  });

  test('keeps check-ins usable without a template and hides the reminder copy', async () => {
    const requestSubscribeMessage = vi.fn();
    (globalThis as any).wx.requestSubscribeMessage = requestSubscribeMessage;
    const state = serverState({ template: undefined, reminder: { enabled: false, quota: 0 } });
    const api = medicationsApi(state);
    const page = createMedicationsPage(api);
    page.onLoad({});
    await page.onShow();

    expect(page.data.reminderAvailable).toBe(false);
    expect(page.data.reminderNote).toBe('');
    await page.toggleTaken(tap({ slot: '20:00', id: 'm1' }));
    expect(requestSubscribeMessage).not.toHaveBeenCalled();
    expect(page.data.slots[1].items[0].taken).toBe(true);
    page.openAdd();
    expect(page.data.firstSaveHelp).toBe('');
  });

  test('scrolls to the slot named in a reminder deep link', async () => {
    const page = createMedicationsPage(medicationsApi(serverState()));
    page.onLoad({ slot: '20:00', from: 'reminder' });
    await page.onShow();
    expect(page.data.scrollTo).toBe('slot-2000');

    const other = createMedicationsPage(medicationsApi(serverState()));
    other.onLoad({ slot: '13:00', from: 'reminder' });
    await other.onShow();
    expect(other.data.scrollTo).toBe('');

    const plain = createMedicationsPage(medicationsApi(serverState()));
    plain.onLoad();
    await plain.onShow();
    expect(plain.data.scrollTo).toBe('');
  });

  test('limits the add sheet to 1–4 times', async () => {
    const page = createMedicationsPage(medicationsApi(serverState()));
    page.onLoad({});
    await page.onShow();

    page.openAdd();
    expect(page.data.sheetOn).toBe('on');
    expect(page.data.sheetTitle).toBe('添加常用药');
    expect(page.data.formTimes.map((item: any) => item.value)).toEqual(['08:00']);
    expect(page.data).toMatchObject({ canAddTime: true, canRemoveTime: false });

    page.addTime();
    page.addTime();
    page.addTime();
    expect(page.data.formTimes.map((item: any) => item.value)).toEqual(['08:00', '12:00', '18:00', '20:00']);
    expect(page.data.canAddTime).toBe(false);
    page.addTime();
    expect(page.data.formTimes).toHaveLength(4);

    page.onTimeChange({ currentTarget: { dataset: { index: 1 } }, detail: { value: '13:30' } });
    expect(page.data.formTimes[1].value).toBe('13:30');

    page.removeTime(tap({ index: 3 }));
    page.removeTime(tap({ index: 0 }));
    page.removeTime(tap({ index: 0 }));
    expect(page.data.formTimes.map((item: any) => item.value)).toEqual(['18:00']);
    expect(page.data.canRemoveTime).toBe(false);
    page.removeTime(tap({ index: 0 }));
    expect(page.data.formTimes).toHaveLength(1);
    expect((globalThis as any).wx.showToast).toHaveBeenCalledWith({ title: '至少保留一个时间', icon: 'none' });

    page.onNameInput({ detail: { value: '一'.repeat(25) } });
    expect(page.data.formName).toHaveLength(20);

    page.openEdit(tap({ id: 'm1' }));
    expect(page.data).toMatchObject({ sheetTitle: '修改常用药', editingId: 'm1', formName: '二甲双胍', canRemoveTime: true });
    expect(page.data.formTimes.map((item: any) => item.value)).toEqual(['08:00', '20:00']);
    page.closeSheet();
    expect(page.data.sheetOn).toBe('');
  });

  test('saving the first medication subscribes synchronously and turns the reminder on', async () => {
    const calls: string[] = [];
    const requestSubscribeMessage = vi.fn((options: any) => {
      calls.push('subscribe');
      options.success({ [MEDICATION_TMPL]: 'accept' });
    });
    (globalThis as any).wx.requestSubscribeMessage = requestSubscribeMessage;
    const state = serverState({ medications: [], reminder: { enabled: false, quota: 0 } });
    const api = medicationsApi(state, calls);
    const page = createMedicationsPage(api);
    page.onLoad({});
    await page.onShow();
    expect(page.data.hasMedications).toBe(false);

    page.openAdd();
    expect(page.data.firstSaveHelp).toContain('总是保持以上选择');
    page.onNameInput({ detail: { value: ' 二甲双胍 ' } });
    page.addTime();
    await page.saveForm();

    expect(requestSubscribeMessage).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('subscribe')).toBeLessThan(calls.indexOf('POST /api/app/medications'));
    expect(api.request).toHaveBeenCalledWith('/api/app/medications', { method: 'POST', data: { name: '二甲双胍', times: ['08:00', '12:00'] } });
    expect(api.request).toHaveBeenCalledWith('/api/app/reminders/medication', { method: 'PUT', data: { enabled: true } });
    expect(api.request).toHaveBeenCalledWith('/api/app/reminders/subscriptions', { method: 'POST', data: { accepted: ['medication'] } });
    expect(page.data.sheetOn).toBe('');
    expect(page.data.saving).toBe(false);
    expect(page.data.hasMedications).toBe(true);
    expect(page.data.reminderEnabled).toBe(true);
    expect(page.data.medications[0]).toMatchObject({ name: '二甲双胍', timesText: '08:00　12:00' });

    // A second medication is an ordinary save: no dialog, no plan change.
    page.openAdd();
    expect(page.data.firstSaveHelp).toBe('');
    page.onNameInput({ detail: { value: '阿卡波糖' } });
    await page.saveForm();
    expect(requestSubscribeMessage).toHaveBeenCalledTimes(1);
    expect(api.request.mock.calls.filter((call) => call[0] === '/api/app/reminders/medication')).toHaveLength(1);
    expect(page.data.medications).toHaveLength(2);
  });

  test('shows the limit message from the server and before opening the sheet', async () => {
    const medications = Array.from({ length: 8 }, (_, index) => ({ id: `m${index + 1}`, name: `药${index + 1}`, times: ['08:00'] }));
    const state = serverState({ medications });
    const api = medicationsApi(state);
    const page = createMedicationsPage(api);
    page.onLoad({});
    await page.onShow();

    expect(page.data.canAdd).toBe(false);
    page.openAdd();
    expect(page.data.sheetOn).toBe('');
    expect((globalThis as any).wx.showToast).toHaveBeenCalledWith({ title: '常用药最多 8 种', icon: 'none' });

    page.setData({ sheetOn: 'on', editingId: '', formName: '第九种', formTimes: [{ key: 'x', value: '08:00' }] });
    await page.saveForm();
    expect((globalThis as any).wx.showToast).toHaveBeenLastCalledWith({ title: '常用药最多 8 种', icon: 'none' });
    expect(page.data.saving).toBe(false);
  });

  test('deletes after confirmation and reloads the list', async () => {
    const state = serverState();
    const api = medicationsApi(state);
    const page = createMedicationsPage(api);
    page.onLoad({});
    await page.onShow();

    (globalThis as any).wx.showModal = vi.fn((options: any) => options.success({ confirm: true }));
    page.removeItem(tap({ id: 'm2' }));
    await vi.waitFor(() => expect(page.data.medications).toHaveLength(1));
    expect(api.request).toHaveBeenCalledWith('/api/app/medications/m2', { method: 'DELETE' });
    expect(page.data.medications[0].id).toBe('m1');
    expect(page.data.slots[0].items).toHaveLength(1);
  });
});

describe('weekly report medication line', () => {
  const { buildWeeklyPages, drawWeeklyPage, medicationLine } = commonJs('utils/weekly-report.js');
  const glucose = (id: string, value: number) => ({ id, valueMmol: value, period: 'fasting', measuredAt: '2026-09-05T07:00:00+08:00' });

  test('adds the line to the last image only when something was planned', () => {
    expect(medicationLine({ planned: 14, taken: 10 })).toBe('本周服药：计划 14 次，完成 10 次');
    expect(medicationLine({ planned: 0, taken: 0 })).toBe('');
    expect(medicationLine(undefined)).toBe('');

    const report = { from: '2026-08-30', to: '2026-09-05', sections: { glucose: { series: { points: [glucose('g1', 6)] } }, medication: { planned: 14, taken: 10 } } };
    const result = buildWeeklyPages(report, { unit: 'mmol' });
    expect(result.medicationText).toBe('本周服药：计划 14 次，完成 10 次');
    expect(result.pages.at(-1).medicationText).toBe('本周服药：计划 14 次，完成 10 次');
    const plain = buildWeeklyPages({ ...report, sections: { glucose: report.sections.glucose } }, { unit: 'mmol' });
    expect(plain.medicationText).toBe('');
    expect(plain.pages.at(-1).medicationText).toBeUndefined();
    expect(result.pages.at(-1).height).toBe(plain.pages.at(-1).height + 56);

    const text: Array<{ text: string; y: number }> = [];
    const ctx = { setFontSize: vi.fn(), setFillStyle: vi.fn(), fillRect: vi.fn(), measureText: (value: string) => ({ width: value.length * 22 }), fillText: (value: string, _x: number, y: number) => text.push({ text: value, y }) };
    drawWeeklyPage(ctx, result.pages.at(-1));
    const line = text.find((item) => item.text === '本周服药：计划 14 次，完成 10 次');
    expect(line).toBeDefined();
    expect(line!.y).toBeLessThan(text.find((item) => item.text.startsWith('第 1 / 1 张'))!.y);
  });
});
