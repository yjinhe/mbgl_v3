import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const root = path.resolve(__dirname, '..');
function commonJs(file: string): any {
  const filename = path.join(root, file);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    (id: string) => commonJs(path.relative(root, path.resolve(path.dirname(filename), `${id}.js`))), module, module.exports
  );
  return module.exports;
}
const { buildStatsView, dateParts } = commonJs('utils/stats-view.js');
const { buildWeeklyPages, drawWeeklyPage, PAGE_SIZE } = commonJs('utils/weekly-report.js');
const now = new Date('2026-09-05T10:00:00+08:00');
const glucose = (id: string, value: number, period = 'fasting', measuredAt = '2026-09-05T07:00:00+08:00') => ({ id, valueMmol: value, period, measuredAt });

describe('stats values and periods', () => {
  test('compares only the selected period and keeps a correctly counted daily average', () => {
    const data = { series: { points: [glucose('a', 5), glucose('b', 7), glucose('c', 12, 'post_meal_1h'), glucose('d', 9, 'post_meal_2h')] } };
    const fasting = buildStatsView(data, { now, period: 'fasting' });
    expect(fasting.summary.map((item: any) => item.value)).toEqual([2, '6.0', '7.0', '5.0']);
    expect(fasting.bars.at(-1)).toMatchObject({ count: 2, value: 6, valueText: '6.0' });
    expect(fasting.detailRows.map((item: any) => item.id)).toEqual(['b', 'a']);
    expect(buildStatsView(data, { now, period: 'post_meal_1h' }).summary[1].value).toBe('12.0');
    expect(buildStatsView(data, { now, period: 'post_meal_2h' }).summary[1].value).toBe('9.0');
  });

  test('shows all 90 days and retains every detail, including more than 14 readings', () => {
    const points = Array.from({ length: 24 }, (_, index) => glucose(String(index), 5 + index / 10, 'fasting', new Date(now.getTime() - index * 86400000).toISOString()));
    const view = buildStatsView({ series: { points } }, { now, range: 90 });
    expect(view.bars).toHaveLength(90);
    expect(view.detailRows).toHaveLength(24);
    expect(view.bars.filter((day: any) => !day.missing)).toHaveLength(24);
    expect(view.bars[0]).toMatchObject({ value: null, valueText: '—', count: 0, height: 0 });
  });

  test('uses the selected lipid field and does not equate missing readings with zero', () => {
    const data = { series: [
      { id: 'a', tc: 4, tg: 1, ldl: 2, hdl: 1.1, measuredAt: '2026-09-04T08:00:00+08:00' },
      { id: 'b', tc: 8, tg: null, ldl: 3, hdl: 1.4, measuredAt: '2026-09-05T08:00:00+08:00' }
    ] };
    const tc = buildStatsView(data, { now, metric: 'lipid', lipidKey: 'tc' });
    expect(tc.bars.at(-1).height / tc.bars.at(-2).height).toBeCloseTo(2);
    expect(tc.summary[1].value).toBe('6.00');
    const tg = buildStatsView(data, { now, metric: 'lipid', lipidKey: 'tg' });
    expect(tg.summary[0].value).toBe(1);
    expect(tg.summary[1].value).toBe('1.00');
    expect(tg.bars.at(-1)).toMatchObject({ missing: true, valueText: '—' });
    expect(buildStatsView(data, { now, metric: 'lipid', lipidKey: 'hdl' }).summary[1].value).toBe('1.25');
  });

  test('keeps high readings proportional and converts glucose labels and details together', () => {
    const data = { series: { points: [glucose('a', 18, 'fasting', '2026-09-04T08:00:00+08:00'), glucose('b', 27)] } };
    const view = buildStatsView(data, { now, unit: 'mgdl' });
    expect(view.bars.at(-1).height / view.bars.at(-2).height).toBeCloseTo(1.5);
    expect(view.bars.at(-1).valueText).toBe('486');
    expect(view.chartUnit).toBe('mg/dL');
    expect(view.detailRows[0].lines).toEqual(['486 mg/dL']);
  });

  test('shows no measurements as dashes, and presents both blood-pressure numbers', () => {
    const empty = buildStatsView({ series: [] }, { now, metric: 'bp' });
    expect(empty.summary.map((item: any) => item.value)).toEqual([0, '—', '—', '—']);
    const view = buildStatsView({ series: [{ sbp: 130, dbp: 80, pulse: 72, measuredAt: now.toISOString() }] }, { now, metric: 'bp' });
    expect(view.bars.at(-1)).toMatchObject({ value: 130, secondValue: 80 });
    expect(view.detailRows[0].lines).toEqual(['130/80 mmHg  心率 72']);
  });

  test('uses Beijing dates consistently even when the timestamp is on the previous UTC day', () => {
    expect(dateParts('2026-09-04T17:30:00Z')).toEqual({ date: '2026-09-05', time: '01:30' });
    expect(dateParts('2026-09-05')).toEqual({ date: '2026-09-05', time: '' });
  });
});

describe('weekly image report', () => {
  test('paginates all records without dropping or repeating any and separates glucose periods', () => {
    const points = Array.from({ length: 19 }, (_, index) => glucose(`g${index}`, 5 + index / 10));
    points.push(glucose('one-hour', 9, 'post_meal_1h'), glucose('two-hour', 8, 'post_meal_2h'));
    const report = { from: '2026-08-30T00:00:00+08:00', to: now.toISOString(), sections: { glucose: { series: { points } }, bp: { series: [{ id: 'bp1', sbp: 130, dbp: 80, measuredAt: now.toISOString() }] } } };
    const result = buildWeeklyPages(report, { nickname: '家人', unit: 'mmol' });
    expect(result.totalRecords).toBe(22);
    expect(result.pages).toHaveLength(6);
    expect(result.pages.every((page: any) => page.rows.length <= PAGE_SIZE)).toBe(true);
    const ids = result.pages.flatMap((page: any) => page.rows.map((row: any) => row.id));
    expect(ids).toHaveLength(22);
    expect(new Set(ids).size).toBe(22);
    expect(result.pages.map((page: any) => page.sectionTitle)).toEqual(['血糖 · 空腹', '血糖 · 空腹', '血糖 · 空腹', '血糖 · 餐后1小时', '血糖 · 餐后2小时', '血压']);
    expect(result.pages.at(-1)).toMatchObject({ pageNumber: 6, pageCount: 6, totalRecords: 22 });
  });

  test('excludes records outside the report and includes all four lipid fields with missing markers', () => {
    const report = { from: '2026-08-30T00:00:00+08:00', to: now.toISOString(), sections: { glucose: { series: { points: [glucose('old', 8, 'fasting', '2026-08-29T23:59:00+08:00')] } }, lipid: { series: [{ id: 'lipid1', tc: 4.5, tg: 1.2, ldl: null, hdl: 1.3, measuredAt: now.toISOString() }] } } };
    const result = buildWeeklyPages(report);
    expect(result.totalRecords).toBe(1);
    expect(result.pages[0].rows[0].lines).toEqual(['TC 4.50  TG 1.20', 'LDL-C —  HDL-C 1.30']);
    expect(result.pages[0].metric).toBe('lipid');
  });

  test('draws every record, range, unit, page number and neutral note into the actual canvas', () => {
    const points = Array.from({ length: 8 }, (_, index) => glucose(`g${index}`, 5 + index));
    const result = buildWeeklyPages({ from: '2026-08-30', to: '2026-09-05', sections: { glucose: { series: { points } } } }, { unit: 'mgdl', nickname: '妈妈' });
    const text: Array<{ text: string; y: number }> = [];
    const ctx = { setFontSize: vi.fn(), setFillStyle: vi.fn(), fillRect: vi.fn(), measureText: (value: string) => ({ width: value.length * 22 }), fillText: (value: string, _x: number, y: number) => text.push({ text: value, y }) };
    drawWeeklyPage(ctx, result.pages[0]);
    expect(text.filter((item) => item.text.includes('mg/dL'))).toHaveLength(8);
    expect(text.map((item) => item.text).join('\n')).toContain('2026/08/30 — 2026/09/05');
    expect(text.map((item) => item.text)).toContain('第 1 / 1 张');
    expect(text.map((item) => item.text)).toContain('仅供个人记录与家人沟通，不作为诊疗依据。');
    expect(text.every((item) => item.y > 0 && item.y < result.pages[0].height)).toBe(true);
  });
});

describe('weekly report sharing controls', () => {
  function createPage(ensurePlatformPrivacyAuthorization: () => Promise<unknown> = vi.fn(async () => undefined)) {
    let definition: any;
    new Function('require', 'Page', fs.readFileSync(path.join(root, 'pages/weekly-report/index.js'), 'utf8'))((id: string) => id === '../../utils/privacy' ? { ensurePlatformPrivacyAuthorization } : {}, (page: any) => { definition = page; });
    const page = { ...definition, data: { ...definition.data, imagePath: '/temporary/report.png' }, isCurrent: () => true };
    page.setData = (patch: any) => Object.assign(page.data, patch);
    return page;
  }

  test('preview and share work without asking for photo-album access', () => {
    const wx = { previewImage: vi.fn(), showShareImageMenu: vi.fn(), canIUse: () => true, saveImageToPhotosAlbum: vi.fn(), authorize: vi.fn() };
    vi.stubGlobal('wx', wx);
    try {
      const page = createPage();
      page.preview();
      page.shareImage();
      expect(wx.previewImage).toHaveBeenCalledWith({ current: '/temporary/report.png', urls: ['/temporary/report.png'] });
      expect(wx.showShareImageMenu).toHaveBeenCalledWith(expect.objectContaining({ path: '/temporary/report.png' }));
      expect(wx.saveImageToPhotosAlbum).not.toHaveBeenCalled();
      expect(wx.authorize).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  test('unsupported share capability falls back to a large preview for long-press forwarding', () => {
    const wx = { previewImage: vi.fn(), showShareImageMenu: vi.fn(), canIUse: () => false, showModal: vi.fn((options) => options.success({ confirm: true })) };
    vi.stubGlobal('wx', wx);
    try {
      createPage().shareImage();
      expect(wx.showShareImageMenu).not.toHaveBeenCalled();
      expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '长按图片转发' }));
      expect(wx.previewImage).toHaveBeenCalledWith({ current: '/temporary/report.png', urls: ['/temporary/report.png'] });
    } finally { vi.unstubAllGlobals(); }
  });

  test('cancelling a share does not open another dialog or send an image', () => {
    const wx = { showShareImageMenu: (options: any) => options.fail({ errMsg: 'showShareImageMenu:fail cancel' }), canIUse: () => true, showModal: vi.fn(), previewImage: vi.fn() };
    vi.stubGlobal('wx', wx);
    try {
      createPage().shareImage();
      expect(wx.showModal).not.toHaveBeenCalled();
      expect(wx.previewImage).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  test('does not access the photo album or report success when privacy authorization is refused', async () => {
    const authorizePrivacy = vi.fn().mockRejectedValue(new Error('需要同意隐私保护指引后才能登录'));
    const wx = { saveImageToPhotosAlbum: vi.fn(), showToast: vi.fn(), showModal: vi.fn() };
    vi.stubGlobal('wx', wx);
    try {
      const page = createPage(authorizePrivacy);
      await page.saveImage();
      expect(authorizePrivacy).toHaveBeenCalledTimes(1);
      expect(wx.saveImageToPhotosAlbum).not.toHaveBeenCalled();
      expect(wx.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ icon: 'success' }));
      expect(page.data.saving).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  test('waits for privacy authorization and a successful album write before reporting saved', async () => {
    let allowPrivacy!: () => void;
    const authorizePrivacy = vi.fn(() => new Promise<void>((resolve) => { allowPrivacy = resolve; }));
    let finishSave!: () => void;
    const wx = {
      saveImageToPhotosAlbum: vi.fn((options: any) => { finishSave = () => options.success({}); }),
      showToast: vi.fn()
    };
    vi.stubGlobal('wx', wx);
    try {
      const page = createPage(authorizePrivacy);
      const pending = page.saveImage();
      expect(page.data.saving).toBe(true);
      expect(wx.saveImageToPhotosAlbum).not.toHaveBeenCalled();
      allowPrivacy();
      await Promise.resolve();
      expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/temporary/report.png' }));
      expect(wx.showToast).not.toHaveBeenCalled();
      finishSave();
      await pending;
      expect(wx.showToast).toHaveBeenCalledWith({ title: '这张图片已保存', icon: 'success' });
      expect(page.data.saving).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  test.each([
    ['cancelled', 'saveImageToPhotosAlbum:fail cancel'],
    ['failed', 'saveImageToPhotosAlbum:fail disk full']
  ])('does not report a %s album write as saved and allows retry', async (_state, errMsg) => {
    const authorizePrivacy = vi.fn(async () => undefined);
    const wx = {
      saveImageToPhotosAlbum: vi.fn((options: any) => options.fail({ errMsg })),
      showToast: vi.fn()
    };
    vi.stubGlobal('wx', wx);
    try {
      const page = createPage(authorizePrivacy);
      await page.saveImage();
      expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1);
      expect(wx.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ icon: 'success' }));
      if (errMsg.includes('cancel')) expect(wx.showToast).not.toHaveBeenCalled();
      else expect(wx.showToast).toHaveBeenCalledWith({ title: '保存失败，请重试', icon: 'none' });
      expect(page.data.saving).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('stats loading isolation', () => {
  function createPage(request: any) {
    const stubs: Record<string, any> = {
      '../../utils/api': { getToken: () => 'token', request },
      '../../utils/data-cache': { captureDataLease: () => ({ generation: 1, versions: { records: 1, profile: 1 } }), isDataLeaseCurrent: () => true, isPageFresh: () => false, markPageFresh: vi.fn() },
      '../../utils/page': {
        ensureLogin: async () => true,
        fetchMe: async () => ({ unit: 'mmol' }),
        handleRequestError: () => false,
        friendlyErrorMessage: (error: any, fallback: string) => error.message || fallback
      },
      '../../utils/demo': {},
      '../../utils/metrics': commonJs('utils/metrics.js'),
      '../../utils/stats-view': commonJs('utils/stats-view.js'),
      '../../utils/tabbar': {}
    };
    let definition: any;
    new Function('require', 'Page', fs.readFileSync(path.join(root, 'pages/stats/index.js'), 'utf8'))((id: string) => stubs[id], (value: any) => { definition = value; });
    const page = { ...definition, data: structuredClone(definition.data) };
    page.setData = (patch: any, callback?: () => void) => { Object.assign(page.data, patch); callback?.(); };
    return page;
  }

  test('clears old metric numbers before fetching, shows a retryable error, and recovers', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce({ series: [] });
    const page = createPage(request);
    page.setData({ metric: 'bp', summary: [{ value: '6.0' }], bars: [{ height: 10 }], visibleRows: [{ lines: ['6.0 mmol/L'] }] });
    const first = page.load();
    expect(page.data.summary).toEqual([]);
    expect(page.data.visibleRows).toEqual([]);
    expect(page.data.loading).toBe(true);
    await first;
    expect(page.data.error).toBe('网络断开');
    expect(page.data.loading).toBe(false);
    await page.load();
    expect(page.data.error).toBe('');
    expect(page.data.summary.map((item: any) => item.value)).toEqual([0, '—', '—', '—']);
    expect(request).toHaveBeenCalledWith('/api/app/stats?metric=bp&range=7');
  });

  test('does not let a delayed glucose result overwrite a newer blood-pressure selection', async () => {
    let resolveOld!: (value: unknown) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce({ series: [] });
    const page = createPage(request);
    const old = page.load();
    await Promise.resolve();
    page.setData({ metric: 'bp' });
    await page.load();
    resolveOld({ series: { points: [glucose('old', 8)] } });
    await old;
    expect(page.data.metric).toBe('bp');
    expect(page.data.chartUnit).toBe('mmHg');
    expect(page.data.totalCount).toBe(0);
  });
});
