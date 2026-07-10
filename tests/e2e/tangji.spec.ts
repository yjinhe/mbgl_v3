import { test, expect } from '@playwright/test';

test('C端登录后显示血糖首页', async ({ page }) => {
  await page.goto('/');
  await page.getByText('微信一键登录').click();
  await expect(page.getByText('血糖 · 最近一次')).toBeVisible();
});

test('C端可打开录入弹层并显示血压面板', async ({ page }) => {
  await page.goto('/');
  await page.getByText('微信一键登录').click();
  await page.locator('.fab').click();
  await page.locator('.sheet').getByRole('button', { name: '血压' }).click();
  await expect(page.getByText('收缩压')).toBeVisible();
});

test('C端录入血糖备注会显示在历史记录', async ({ page }) => {
  const note = `备注-${Date.now()}`;
  await page.goto('/');
  await page.getByText('微信一键登录').click();
  await page.locator('.tab').filter({ hasText: '我的' }).click();
  await page.getByRole('button', { name: 'mmol/L' }).click();
  await page.locator('.tab').filter({ hasText: '首页' }).click();
  await page.locator('.fab').click();
  for (const key of ['6', '·', '4']) {
    await page.locator('.sheet .key').filter({ hasText: key }).click();
  }
  await page.locator('.sheet .note-in').fill(note);
  await page.locator('.sheet .key.save').click();
  await expect(page.locator('.toast')).toContainText('已记录');
  await page.locator('.tab').filter({ hasText: '历史' }).click();
  await expect(page.getByText(note)).toBeVisible();
});

test('药房后台可登录并查看客户列表', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText('客户总数')).toBeVisible();
  await page.getByText('客户管理').click();
  await expect(page.getByPlaceholder('搜索客户昵称…')).toBeVisible();
});

test('药房店长可以读取并保存药房资料', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.locator('.blogin input').nth(0).fill('kangning');
  await page.locator('.blogin input').nth(1).fill('Kn@123456');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('药房设置').click();
  await expect(page.getByPlaceholder('药房名称')).toHaveValue(/康宁大药房/);
  await page.getByPlaceholder('门店地址').fill('中山路 128 号');
  await page.getByPlaceholder('联系电话').fill('0571-87654321');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.btoast')).toContainText('药房资料已保存');
});

test('平台管理员通过独立登录模式进入后台', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174/?admin=1');
  await expect(page.getByRole('button', { name: '平台管理员' })).toHaveClass(/on/);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('main').getByText('平台概览')).toBeVisible();
});

test('C端可切换血糖单位到 mg/dL', async ({ page }) => {
  await page.goto('/');
  await page.getByText('微信一键登录').click();
  await page.locator('.tab').filter({ hasText: '我的' }).click();
  await page.getByRole('button', { name: 'mg/dL' }).click();
  await expect(page.getByText('已切换为 mg/dL · 全部数据自动换算')).toBeVisible();
});

test('C端可查看周报、导出数据并打开回收站', async ({ page }) => {
  await page.goto('/');
  await page.getByText('微信一键登录').click();
  await page.locator('.tab').filter({ hasText: '统计' }).click();
  await page.getByRole('button', { name: '生成健康周报' }).click();
  await expect(page.locator('#reportCard')).toBeVisible();
  await expect(page.getByText('近 7 天健康报告')).toBeVisible();
  await page.getByRole('button', { name: '导出数据' }).click();
  await expect(page.getByRole('button', { name: '全部（ZIP）' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '‹' }).click();

  await page.locator('.tab').filter({ hasText: '我的' }).click();
  await expect(page.getByText('数据与隐私')).toBeVisible();
  await page.locator('.page.on .cell').filter({ hasText: '回收站' }).click();
  await expect(page.getByText(/回收站为空|剩余 \d+ 天/)).toBeVisible();
});

test('药房后台可标记预警跟进', async ({ page }) => {
  await page.goto('/');
  await page.getByText('微信一键登录').click();
  await page.locator('.fab').click();
  await page.locator('.sheet').getByRole('button', { name: '血压' }).click();
  for (const digit of ['1', '8', '5']) await page.locator('.sheet .key').filter({ hasText: digit }).click();
  for (const digit of ['1', '1', '5']) await page.locator('.sheet .key').filter({ hasText: digit }).click();
  await page.locator('.sheet .key.save').click();
  await expect(page.getByText('本次血压偏高')).toBeVisible();

  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('预警中心').click();
  const follow = page.getByRole('button', { name: '标记跟进' });
  await follow.first().click();
  await expect(page.getByText('已标记跟进')).toBeVisible();
});
