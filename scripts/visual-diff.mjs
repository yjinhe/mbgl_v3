import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'docs/screenshots');
const pngModule = path.join(root, 'node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs/browser.js');
const { PNG } = await import(`file://${pngModule}`);
const apiBase = process.env.VITE_API_BASE || 'http://127.0.0.1:3001';

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const cases = [
    {
      name: 'glucose-home',
      prototypeSetup: async () => {},
      appSetup: async () => {
        await loginApp(page);
      }
    },
    {
      name: 'glucose-sheet',
      prototypeSetup: async () => {
        await page.evaluate(() => globalThis.openSheet?.(null));
      },
      appSetup: async () => {
        await loginApp(page);
        await page.locator('.fab').click();
      }
    }
  ];

  const summary = [];
  for (const item of cases) {
    const protoPath = path.join(outDir, `prototype-${item.name}.png`);
    const appPath = path.join(outDir, `app-${item.name}.png`);
    const diffPath = path.join(outDir, `diff-${item.name}.png`);
    await page.goto(`file://${path.join(root, 'design/prototype.html')}`);
    await normalizePrototypeCanvas(page);
    await item.prototypeSetup();
    await page.locator('#paneC .screen').screenshot({ path: protoPath, animations: 'disabled' });

    await page.goto('http://127.0.0.1:5173');
    await item.appSetup();
    await normalizeAppCanvas(page);
    await page.locator('.screen').screenshot({ path: appPath, animations: 'disabled' });
    summary.push({ page: item.name, ...(await diffPng(protoPath, appPath, diffPath)) });
  }
  await browser.close();
  await writeFile(path.join(outDir, 'visual-diff-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

async function normalizePrototypeCanvas(page) {
  await page.addStyleTag({
    content: `
      body{background:var(--desk)!important;background-image:none!important}
      *,*::before,*::after{animation:none!important;transition:none!important}
      .stage{min-height:auto!important;padding:0!important;gap:0!important;align-items:flex-start!important;justify-content:flex-start!important}
      .side,.pane-label,.pane-b,.top-switch{display:none!important}
    `
  });
}

async function normalizeAppCanvas(page) {
  await page.addStyleTag({
    content: `
      body{background:var(--desk)!important;background-image:none!important}
      *,*::before,*::after{animation:none!important;transition:none!important}
      .app-stage{min-height:auto!important;padding:0!important;align-items:flex-start!important;justify-content:flex-start!important}
    `
  });
}

async function loginApp(page) {
  await page.evaluate(() => localStorage.clear());
  const loginCode = `visual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const login = await fetch(`${apiBase}/api/app/auth/wechat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: loginCode })
  });
  if (!login.ok) throw new Error(`visual login failed: ${login.status}`);
  const { token } = await login.json();
  await page.evaluate((value) => localStorage.setItem('tangji_app_token', value), token);
  await seedVisualRecords(page);
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForFunction(() => document.querySelector('.hero .v')?.textContent?.trim() === '8.2');
}

async function seedVisualRecords(page) {
  const token = await page.evaluate(() => localStorage.getItem('tangji_app_token'));
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const today = new Date();
  const at = (hour, minute, dayOffset = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() - dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const post = (path, body) => fetch(`${apiBase}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  await fetch(`${apiBase}/api/app/me`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ unit: 'mmol', sex: 'male' })
  });
  await post('/api/app/records/glucose', { value: 6.1, unit: 'mmol', period: 'fasting', measuredAt: at(6, 52) });
  await post('/api/app/records/glucose', { value: 8.2, unit: 'mmol', period: 'after_breakfast', measuredAt: at(9, 26), note: '燕麦 + 鸡蛋' });
  await post('/api/app/records/bp', { sbp: 138, dbp: 86, pulse: 76, period: 'morning', measuredAt: at(7, 5), tags: ['服药后'] });
  await post('/api/app/records/lipid', { tc: 5.4, tg: 1.8, ldl: 3.5, hdl: 1.1, fasting: true, measuredAt: at(8, 30, 8) });
  await post('/api/app/records/uric', { value: 418, fasting: true, measuredAt: at(8, 40, 6) });
  for (let day = 1; day < 90; day += 1) {
    await post('/api/app/records/glucose', {
      value: day % 5 === 0 ? 7.4 : 6.3,
      unit: 'mmol',
      period: 'fasting',
      measuredAt: at(7, day % 50, day)
    });
  }
}

async function diffPng(leftPath, rightPath, diffPath) {
  const [left, right] = await Promise.all([readPng(leftPath), readPng(rightPath)]);
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  const diff = new PNG({ width, height });
  let changed = 0;
  let totalDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const li = (left.width * y + x) << 2;
      const ri = (right.width * y + x) << 2;
      const di = (width * y + x) << 2;
      const delta =
        Math.abs(left.data[li] - right.data[ri]) +
        Math.abs(left.data[li + 1] - right.data[ri + 1]) +
        Math.abs(left.data[li + 2] - right.data[ri + 2]) +
        Math.abs(left.data[li + 3] - right.data[ri + 3]);
      if (delta > 24) {
        changed += 1;
        diff.data[di] = 214;
        diff.data[di + 1] = 69;
        diff.data[di + 2] = 61;
        diff.data[di + 3] = 255;
      } else {
        diff.data[di] = 0;
        diff.data[di + 1] = 0;
        diff.data[di + 2] = 0;
        diff.data[di + 3] = 0;
      }
      totalDelta += delta;
    }
  }
  await writeFile(diffPath, PNG.sync.write(diff));
  const compared = width * height;
  return {
    width,
    height,
    changedPixels: changed,
    changedRatio: Number((changed / compared).toFixed(6)),
    averageDelta: Number((totalDelta / compared).toFixed(2))
  };
}

async function readPng(filePath) {
  return PNG.sync.read(await readFile(filePath));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
