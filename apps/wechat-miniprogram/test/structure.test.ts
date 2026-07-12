import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = path.resolve(__dirname, '..');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as T;
}

describe('wechat miniprogram structure', () => {
  test('declares expected pages with a custom Web-like shell', () => {
    const appJson = readJson<{ pages: string[]; tabBar?: unknown; window: { navigationStyle?: string } }>('app.json');

    expect(appJson.pages).toEqual([
      'pages/home/index',
      'pages/history/index',
      'pages/record/index',
      'pages/stats/index',
      'pages/mine/index',
      'pages/bind/index',
      'pages/recycle/index'
    ]);
    expect(appJson.window.navigationStyle).toBe('custom');
    expect(appJson.tabBar).toBeUndefined();
  });

  test('ships every declared page with wxml, wxss, js, and json files', () => {
    const appJson = readJson<{ pages: string[] }>('app.json');

    for (const page of appJson.pages) {
      for (const ext of ['wxml', 'wxss', 'js', 'json']) {
        expect(fs.existsSync(path.join(root, `${page}.${ext}`)), `${page}.${ext}`).toBe(true);
      }
    }
  });

  test('has API auth plumbing and key user flows wired in markup', () => {
    const apiJs = fs.readFileSync(path.join(root, 'utils/api.js'), 'utf8');
    const metricsJs = fs.readFileSync(path.join(root, 'utils/metrics.js'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const recordWxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8');
    const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');

    expect(apiJs).toContain('Authorization');
    expect(apiJs).toContain('/api/app/auth/wechat');
    expect(homeWxml).toContain('微信一键登录');
    expect(recordWxml).toContain('保存记录');
    expect(recordWxml).toContain('wx:for="{{metrics}}"');
    expect(metricsJs).toContain("name: '血糖'");
    expect(metricsJs).toContain("name: '血压'");
    expect(metricsJs).toContain("name: '血脂'");
    expect(metricsJs).toContain("name: '尿酸'");
    expect(mineWxml).toContain('绑定服务药房');
    expect(mineWxml).toContain('回收站');
  });

  test('keeps logout separate from irreversible account deletion', () => {
    const mineJs = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
    const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');

    expect(mineWxml).toContain('退出登录');
    expect(mineWxml).toContain('仅清除本机登录状态');
    expect(mineWxml).toContain('注销账号');
    expect(mineWxml).toContain('永久删除账号及全部关联数据');
    expect(mineJs).toContain("request('/api/app/me', { method: 'DELETE' })");
    expect(mineJs).toContain('me.stats.totalRecords');
    expect(mineJs).toContain('四类指标合计');
    expect(mineJs).toContain('该操作不可恢复');
    expect(mineJs).toContain('如需留底，请先导出数据');
    expect(mineJs).toContain("cancelText: '再想想'");
    expect(mineJs).toContain("confirmText: '确认注销'");
    expect(mineJs).toContain("wx.reLaunch({ url: '/pages/home/index' })");
  });

  test('uses a mini-program-safe Web-like shell without fake status or capsule chrome', () => {
    const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const recordWxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8');
    const bindWxml = fs.readFileSync(path.join(root, 'pages/bind/index.wxml'), 'utf8');
    const recycleWxml = fs.readFileSync(path.join(root, 'pages/recycle/index.wxml'), 'utf8');

    for (const anchor of ['screen', 'safe-navbar', 'pages', 'tabbar', 'fab', 'hero', 'mcard']) {
      expect(homeWxml).toContain(anchor);
    }
    for (const wxml of [bindWxml, recycleWxml]) {
      expect(wxml).toContain('screen');
      expect(wxml).toContain('safe-navbar');
      expect(wxml).toContain('pages');
    }
    expect(homeWxml).not.toContain('statusbar');
    expect(homeWxml).not.toContain('capsule');
    for (const anchor of ['sheet', 'sheet-h', 'sheet-body', 'bignum', 'keypad', 'record-actions', 'record-save', 'mask']) {
      expect(recordWxml).toContain(anchor);
    }
    for (const cssClass of ['.screen', '.safe-navbar', '.tabbar', '.fab', '.hero', '.mcard', '.sheet', '.keypad']) {
      expect(appWxss).toContain(cssClass);
    }
    expect(appWxss).not.toContain('.statusbar');
    expect(appWxss).not.toContain('.capsule');
  });

  test('uses native mini-program tags in WXML instead of browser-only text tags', () => {
    const appJson = readJson<{ pages: string[] }>('app.json');

    for (const page of appJson.pages) {
      const wxml = fs.readFileSync(path.join(root, `${page}.wxml`), 'utf8');
      expect(wxml, page).not.toMatch(/<\/?(small|b)\b/);
    }
  });

  test('guards native system-info APIs so simulator object errors do not break launch', () => {
    const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    expect(appJs).toContain('safeWxCall');
    expect(appJs).toContain('safeWxCall(() => wx.getWindowInfo');
    expect(appJs).toContain('safeWxCall(() => wx.getSystemInfoSync()');
    expect(appJs).toContain('safeWxCall(() => wx.getMenuButtonBoundingClientRect');
  });

  test('uses the production HTTPS API host', () => {
    const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    expect(appJs).toContain("apiBase: 'https://tangji.aiteam.pw'");
    expect(appJs).not.toContain("apiBase: 'http://127.0.0.1:3001'");
  });
});
