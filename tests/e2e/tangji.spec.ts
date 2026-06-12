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

test('药房后台可登录并查看客户列表', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText('客户总数')).toBeVisible();
  await page.getByText('客户管理').click();
  await expect(page.getByPlaceholder('搜索客户昵称…')).toBeVisible();
});

test('C端可切换血糖单位到 mg/dL', async ({ page }) => {
  await page.goto('/');
  await page.getByText('微信一键登录').click();
  await page.locator('.tab').filter({ hasText: '我的' }).click();
  await page.getByRole('button', { name: 'mg/dL' }).click();
  await expect(page.getByText('已切换为 mg/dL · 全部数据自动换算')).toBeVisible();
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
