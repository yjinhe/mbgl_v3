import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Run against an isolated development database initialized by init-dev-db.ts.
const consoleUrl = process.env.VERIFY_CONSOLE_URL || 'http://127.0.0.1:5474';
assert.equal(new URL(consoleUrl).hostname, '127.0.0.1', 'Verification requires a local test environment');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const note = `本地验收备注-${Date.now().toString(36)}`;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${consoleUrl}/?admin=1`);
  await page.getByRole('textbox', { name: '用户名' }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '用户与记录' }).waitFor();
  await page.locator('.admin-user-table tbody tr').first().waitFor();
  if (process.env.VERIFY_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.VERIFY_SCREENSHOTS_DIR}/admin-users.png`, fullPage: true });
  await page.getByRole('button', { name: '查看记录' }).first().click();
  await page.getByLabel('管理员备注', { exact: true }).fill(note);
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await page.getByText('管理员备注已保存', { exact: true }).waitFor();
  await page.locator('.admin-record-table tbody tr').first().waitFor();
  assert.match(await page.locator('.admin-record-table').innerText(), /mmol\/L/);
  if (process.env.VERIFY_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.VERIFY_SCREENSHOTS_DIR}/admin-user-detail.png`, fullPage: true });
  await page.getByRole('button', { name: '血压', exact: true }).click();
  await page.getByText(/186\/112 mmHg/).waitFor();
  await page.getByRole('button', { name: '‹ 返回用户列表' }).click();
  await page.getByRole('textbox', { name: '搜索昵称、管理员备注或用户编号' }).fill(note);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText(note, { exact: true }).waitFor();
  assert.equal(await page.locator('.admin-user-table tbody tr').count(), 1);
  await page.getByRole('textbox', { name: '搜索昵称、管理员备注或用户编号' }).fill('不存在的测试用户');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('没有符合条件的用户').waitFor();
  assert.deepEqual(errors, []);
  console.log('Admin browser verification passed: login, user list, records, note, filters, search and empty state.');
} finally {
  await browser.close();
}
