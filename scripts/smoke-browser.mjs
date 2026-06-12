import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
const login = page.getByText('微信一键登录');
if (await login.count()) await login.click();
await page.waitForTimeout(1200);
const web = await page.evaluate(() => {
  const q = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      text: el.textContent?.replace(/\s+/g, ' ').slice(0, 120)
    };
  };
  return {
    screen: q('.screen'),
    hero: q('.hero'),
    text: document.body.textContent?.replace(/\s+/g, ' ').slice(0, 220)
  };
});
await page.screenshot({ path: 'docs/screenshots/web-home.png' });

const page2 = await browser.newPage({ viewport: { width: 1280, height: 960 } });
await page2.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
const bLogin = page2.getByRole('button', { name: '登录' });
if (await bLogin.count()) await bLogin.click();
await page2.waitForTimeout(1200);
const consoleInfo = await page2.evaluate(() => {
  const el = document.querySelector('.bshell');
  const rect = el?.getBoundingClientRect();
  return {
    shell: rect && { w: Math.round(rect.width), h: Math.round(rect.height) },
    text: document.body.textContent?.replace(/\s+/g, ' ').slice(0, 220)
  };
});
await page2.screenshot({ path: 'docs/screenshots/console-dashboard.png' });
await browser.close();

console.log(JSON.stringify({ web, consoleInfo }, null, 2));
