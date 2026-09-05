import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = path.resolve('apps/wechat-miniprogram/utils');
const modules = new Map();
function load(name) {
  const filename = path.join(root, `${name.replace(/^\.\//, '')}.js`);
  if (modules.has(filename)) return modules.get(filename);
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(load, mod, mod.exports);
  modules.set(filename, mod.exports);
  return mod.exports;
}
const { buildWeeklyPages, drawWeeklyPage } = load('weekly-report');
const when = (index) => `2026-09-0${index % 5 + 1}T08:00:00+08:00`;
const report = { from: '2026-08-30T00:00:00+08:00', to: '2026-09-05T12:00:00+08:00', sections: {
  glucose: { series: { points: Array.from({ length: 9 }, (_, index) => ({ id: `g${index}`, valueMmol: 5.5 + index / 10, period: 'post_meal_2h', measuredAt: when(index) })) } },
  bp: { series: [{ id: 'bp', sbp: 128, dbp: 78, pulse: 72, period: 'morning', measuredAt: when(0) }] },
  lipid: { series: Array.from({ length: 8 }, (_, index) => ({ id: `l${index}`, tc: 4.8, tg: 1.2, ldl: 2.6, hdl: null, measuredAt: when(index) })) },
  uric: { series: [{ id: 'u', value: 320, measuredAt: when(1) }] }
} };
const model = buildWeeklyPages(report, { nickname: '妈妈（本地演示）', demo: true });
assert.equal(model.totalRecords, 19);
assert.equal(model.pages.flatMap((page) => page.rows).length, 19);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  const page = await browser.newPage();
  for (const sample of [model.pages[0], model.pages.find((item) => item.metric === 'lipid')]) {
    await page.setViewportSize({ width: sample.width, height: sample.height });
    const overflow = await page.evaluate(({ model, draw }) => {
      document.body.style.margin = '0';
      const canvas = document.createElement('canvas');
      canvas.width = model.width; canvas.height = model.height;
      document.body.replaceChildren(canvas);
      const native = canvas.getContext('2d');
      const overflow = [];
      const ctx = {
        setFontSize(size) { native.font = `${size}px "PingFang SC", sans-serif`; },
        setFillStyle(color) { native.fillStyle = color; },
        fillRect(...args) { native.fillRect(...args); },
        measureText(value) { return native.measureText(value); },
        fillText(value, x, y) {
          if (x + native.measureText(value).width > model.width - 24 || y > model.height || y < 0) overflow.push(value);
          native.fillText(value, x, y);
        }
      };
      new Function('ctx', 'model', `(${draw})(ctx, model);`)(ctx, model);
      return overflow;
    }, { model: sample, draw: drawWeeklyPage.toString() });
    assert.deepEqual(overflow, [], 'Report text must fit inside its image');
    if (process.env.VERIFY_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.VERIFY_SCREENSHOTS_DIR}/weekly-${sample.metric}.png` });
  }
  console.log('Weekly image verification passed: all records paginated, same canvas drawing rendered, text fits.');
} finally { await browser.close(); }
