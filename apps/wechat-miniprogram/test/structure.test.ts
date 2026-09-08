import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = path.resolve(__dirname, '..');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as T;
}

describe('wechat miniprogram structure', () => {
  test('declares expected pages with a custom shell and native tab routing', () => {
    const appJson = readJson<{
      pages: string[];
      tabBar?: { custom?: boolean; list?: Array<{ pagePath: string }> };
      window: { navigationStyle?: string };
      __usePrivacyCheck__?: boolean;
    }>('app.json');

    expect(appJson.pages).toEqual([
      'pages/home/index',
      'pages/history/index',
      'pages/record/index',
      'pages/stats/index',
      'pages/mine/index',
      'pages/recycle/index',
      'pages/weekly-report/index',
      'pages/reminders/index',
      'pages/medications/index',
      'pages/legal/privacy/index',
      'pages/legal/terms/index'
    ]);
    expect(appJson.window.navigationStyle).toBe('custom');
    expect(appJson.__usePrivacyCheck__).toBe(true);
    expect(appJson.tabBar?.custom).toBe(true);
    expect(appJson.tabBar?.list?.map((item) => item.pagePath)).toEqual([
      'pages/home/index',
      'pages/history/index',
      'pages/record/index',
      'pages/stats/index',
      'pages/mine/index'
    ]);
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
    expect(homeWxml).toContain('微信登录并保存记录');
    expect(recordWxml).toContain('保存记录');
    expect(recordWxml).toContain('wx:for="{{metrics}}"');
    expect(metricsJs).toContain("name: '血糖'");
    expect(metricsJs).toContain("name: '血压'");
    expect(metricsJs).toContain("name: '血脂'");
    expect(metricsJs).toContain("name: '尿酸'");
    expect(mineWxml).toContain('导出全部记录');
    expect(mineWxml).toContain('回收站');
    expect(fs.readFileSync(path.join(root, 'pages/recycle/index.wxml'), 'utf8')).toContain('永久删除');
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
    const recycleWxml = fs.readFileSync(path.join(root, 'pages/recycle/index.wxml'), 'utf8');
    const privacyWxml = fs.readFileSync(path.join(root, 'pages/legal/privacy/index.wxml'), 'utf8');
    const tabBarWxml = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxml'), 'utf8');
    const tabBarWxss = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8');

    for (const anchor of ['screen', 'safe-navbar', 'pages', 'hero', 'mcard']) {
      expect(homeWxml).toContain(anchor);
    }
    for (const anchor of ['tabbar', 'fab-slot', 'fab', 'fab-label']) {
      expect(tabBarWxml).toContain(anchor);
    }
    for (const wxml of [recycleWxml, privacyWxml]) {
      expect(wxml).toContain('screen');
      expect(wxml).toContain('safe-navbar');
      expect(wxml).toContain('pages');
    }
    expect(homeWxml).not.toContain('statusbar');
    expect(homeWxml).not.toContain('capsule');
    for (const anchor of ['sheet', 'sheet-h', 'sheet-body', 'bignum', 'keypad', 'record-actions', 'record-save', 'mask']) {
      expect(recordWxml).toContain(anchor);
    }
    for (const cssClass of ['.screen', '.safe-navbar', '.hero', '.mcard', '.sheet', '.keypad']) {
      expect(appWxss).toContain(cssClass);
    }
    for (const cssClass of ['.tabbar', '.tab', '.fab', '.fab-label']) {
      expect(tabBarWxss).toContain(cssClass);
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

  test('uses the elder-friendly homepage overview and floating navigation', () => {
    const homeJs = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const homeWxss = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
    const tabBarWxss = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8');

    expect(homeJs).toContain('overviewStatusLabel');
    expect(homeJs).toContain("status.key === 'ok' ? '达标'");
    expect(homeJs).toContain('cards.every((card) => card.empty)');
    expect(homeJs).toContain('cards.filter((card) => card.isBp || card.isUric)');
    expect(homeWxml).toContain('最近记录总览');
    expect(homeWxml).toContain('overview-grid');
    expect(homeWxml).toContain('overview-empty');
    expect(homeWxml).toContain('streakMessage');
    expect(homeWxml).toContain('support-grid');
    expect(homeWxml).not.toMatch(/[⌂☰↗◯]/);
    expect(homeWxss).toContain('.overview-grid');
    expect(homeWxss).toContain('flex: 1 1 0');
    expect(homeWxss).toContain('min-height: 196rpx');
    expect(tabBarWxss).toContain('width: 108rpx');
    expect(tabBarWxss).toMatch(/\.tabbar\s*\{[^}]*bottom:\s*0;/);
    expect(tabBarWxss).toContain('env(safe-area-inset-bottom)');
    for (const token of ['var(--m-glucose-soft)', 'var(--m-bp-soft)', 'var(--m-lipid-soft)', 'var(--m-uric-soft)']) {
      expect(homeWxss).toContain(token);
    }
  });

  test('uses one native custom tab bar instead of rebuilding navigation on every page', () => {
    const tabBarJs = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8');
    const tabBarWxml = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxml'), 'utf8');
    const tabBarWxss = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8');
    const tabBarUtil = fs.readFileSync(path.join(root, 'utils/tabbar.js'), 'utf8');

    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      expect(fs.existsSync(path.join(root, `custom-tab-bar/index.${ext}`))).toBe(true);
    }
    expect(tabBarJs).toContain('wx.switchTab');
    expect(tabBarJs).toContain('setRecordReturnPath');
    expect(tabBarJs).not.toContain('setStorageSync');
    expect(tabBarWxml).toContain('class="tabbar"');
    expect(tabBarWxml).toContain('wx:if="{{!hidden}}"');
    expect(tabBarWxml).toContain('class="fab-slot"');
    expect(tabBarUtil).toContain('/assets/home-icons/nav-record.png');
    expect(tabBarWxss).toMatch(/\.tabbar\s*\{[^}]*--brand:\s*#0E7E6B;/);
    expect(tabBarWxss).toContain('left: 0');
    expect(tabBarWxss).toContain('right: 0');
    expect(tabBarWxss).toContain('border-radius: 28rpx 28rpx 0 0');
    expect(tabBarWxss).toContain('height: auto');
    expect(tabBarWxss).toContain('max(4rpx, calc(env(safe-area-inset-bottom) - 16rpx))');
    expect(tabBarWxss).toContain('top: -40rpx');
    expect(tabBarJs).toContain("route === 'pages/record/index'");
    expect(tabBarUtil).toContain("route === 'pages/record/index'");
    for (const page of ['home', 'history', 'stats', 'mine', 'record']) {
      const wxml = fs.readFileSync(path.join(root, `pages/${page}/index.wxml`), 'utf8');
      const js = fs.readFileSync(path.join(root, `pages/${page}/index.js`), 'utf8');
      expect(wxml, page).not.toContain('class="tabbar');
      expect(js, page).toContain('syncTabBar(this)');
      expect(js, page).not.toContain('switchPage(event)');
    }
    const mineJs = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
    const recordJs = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
    expect(mineJs).toContain('loadMe(this');
    expect(recordJs).toContain('loadMe(this');
    expect(mineJs).not.toContain('loadAppData(this)');
    expect(recordJs).not.toContain('loadAppData(this)');
  });

  test('guards native system-info APIs so simulator object errors do not break launch', () => {
    const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    expect(appJs).toContain('safeWxCall');
    expect(appJs).toContain('safeWxCall(() => wx.getWindowInfo');
    expect(appJs).toContain('safeWxCall(() => wx.getSystemInfoSync()');
    expect(appJs).toContain('safeWxCall(() => wx.getMenuButtonBoundingClientRect');
    expect(appJs).toContain('--nav-title-y');
  });

  test('uses the production HTTPS API host', () => {
    const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    expect(appJs).toContain("apiBase: 'https://tangji.aiteam.pw'");
    expect(appJs).not.toContain("apiBase: 'http://127.0.0.1:3001'");
  });

  test('requires versioned consent and ships permanent legal entry points', () => {
    const privacyJs = fs.readFileSync(path.join(root, 'utils/privacy.js'), 'utf8');
    const pageJs = fs.readFileSync(path.join(root, 'utils/page.js'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');

    expect(privacyJs).toContain("CONSENT_VERSION = '2026-09-05'");
    expect(fs.readFileSync(path.join(root, 'pages/legal/privacy/index.wxml'), 'utf8')).toContain('更新及生效日期：2026 年 9 月 5 日');
    expect(privacyJs).toContain('wx.getPrivacySetting');
    expect(privacyJs).toContain('wx.requirePrivacyAuthorize');
    expect(privacyJs).toContain('wx.openPrivacyContract');
    expect(pageJs).toContain('hasConsent()');
    expect(homeWxml).toContain('并同意处理我主动填写的健康数据');
    expect(homeWxml).toContain('《用户协议》');
    expect(homeWxml).toContain('《隐私政策》');
    expect(mineWxml).toContain('微信隐私保护指引');
  });

  test('allows a useful guest experience before optional login', () => {
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const historyWxml = fs.readFileSync(path.join(root, 'pages/history/index.wxml'), 'utf8');
    const statsWxml = fs.readFileSync(path.join(root, 'pages/stats/index.wxml'), 'utf8');
    const recordWxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8');
    const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');
    const recordJs = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
    const pageJs = fs.readFileSync(path.join(root, 'utils/page.js'), 'utf8');
    const demoJs = fs.readFileSync(path.join(root, 'utils/demo.js'), 'utf8');

    for (const markup of [homeWxml, historyWxml, statsWxml, recordWxml]) {
      expect(markup).toContain('功能演示');
    }
    expect(mineWxml).toContain('游客体验');
    expect(demoJs).toContain('demoOverview');
    expect(demoJs).toContain('demoRecords');
    expect(demoJs).toContain('demoStats');
    expect(recordJs).not.toContain('wx.reLaunch');
    expect(recordJs).toContain('promptLoginForAction({ metric, data, clientRequestId:');
    expect(pageJs).toContain("cancelText: '继续体验'");
    expect(pageJs).toContain("confirmText: '去登录并保存'");
    expect(pageJs).toContain('tangji_pending_record');
    expect(homeWxml).toContain('本次填写内容已保留');
    expect(homeWxml).toContain('登录成功后会自动保存');
    expect(homeWxml).toContain('本次记录还没有保存成功');
    expect(homeWxml).toContain('重新保存');
    expect(homeWxml.indexOf('功能演示')).toBeLessThan(homeWxml.indexOf('微信登录并保存记录'));
  });

  test('uses flex layouts for controls that must fit narrow mini-program screens', () => {
    const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
    const homeWxss = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
    const statsWxss = fs.readFileSync(path.join(root, 'pages/stats/index.wxss'), 'utf8');
    const recordWxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8');

    expect(`${appWxss}\n${homeWxss}`).not.toMatch(/display:\s*grid|grid-template|grid-auto/);
    expect(appWxss).toContain('flex: 0 0 calc((100% - 28rpx) / 3)');
    expect(statsWxss).toContain('flex: 1 1 0');
    expect(recordWxml).toContain('switch-knob');
    expect(recordWxml).toContain("{{fasting ? '是' : '否'}}");
  });

  test('keeps record return context and exposes permanent recycle deletion', () => {
    const homeJs = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
    const recordJs = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
    const recycleJs = fs.readFileSync(path.join(root, 'pages/recycle/index.js'), 'utf8');
    const tabBarJs = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8');

    expect(homeJs).toContain("setRecordReturnPath('/pages/home/index')");
    expect(tabBarJs).toContain('setRecordReturnPath');
    expect(recordJs).toContain("consumeRecordReturnPath('/pages/home/index')");
    expect(recordJs).toContain('wx.switchTab({');
    expect(recordJs).toContain('url: returnPath');
    expect(recycleJs).toContain("method: 'DELETE'");
    expect(recycleJs).toContain('/permanent');
  });

  test('keeps record actions visible and provides elder-friendly input guidance', () => {
    const recordJs = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
    const recordWxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8');
    const recordWxss = fs.readFileSync(path.join(root, 'pages/record/index.wxss'), 'utf8');
    const homeJs = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');

    expect(recordWxml).toContain('class="scroll-affordance"');
    expect(recordWxml).toContain('end="{{dateMax}}"');
    expect(recordWxml).toContain('{{periodHintText}}');
    expect(recordWxml).toContain('disabled="{{decimalKeyDisabled}}"');
    expect(recordWxml).toContain('例如饮食、运动或身体感受');
    expect(recordWxss).toContain('.record-actions');
    expect(recordWxss).toContain('height: 96rpx');
    expect(recordJs).toContain('captureMetricDraft');
    expect(recordJs).toContain('measurementTimeError');
    expect(recordJs).toContain('showSaveSuccess');
    expect(homeWxml).toContain('返回修改');
    expect(homeWxml).toContain('放弃记录');
    expect(homeJs).toContain('editPendingRecord');
    expect(homeJs).toContain('result.safetyAlert');
  });

  test('keeps tab switches off synchronous storage and skips fresh data reloads', () => {
    const apiJs = fs.readFileSync(path.join(root, 'utils/api.js'), 'utf8');
    const privacyJs = fs.readFileSync(path.join(root, 'utils/privacy.js'), 'utf8');
    const pageJs = fs.readFileSync(path.join(root, 'utils/page.js'), 'utf8');
    const tabBarJs = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8');
    const recordJs = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
    const statsJs = fs.readFileSync(path.join(root, 'pages/stats/index.js'), 'utf8');

    expect(apiJs).toContain('tokenCache');
    expect(apiJs).toContain('error.statusCode');
    expect(privacyJs).toContain('consentCache');
    expect(pageJs).toContain('getMeCached');
    expect(pageJs).toContain('error.statusCode === 401');
    expect(tabBarJs).toContain('this._switching');
    expect(tabBarJs).not.toContain('this.setData({ selected: index');
    expect(recordJs).toContain('isProfileFresh()');
    expect(recordJs).not.toContain("wx.getStorageSync('tangji_record_metric')");
    expect(statsJs).toContain('isDataFresh()');
    expect(statsJs).not.toContain("wx.getStorageSync('tangji_stat_metric')");
    for (const page of ['home', 'history', 'record', 'stats', 'mine', 'recycle']) {
      const source = fs.readFileSync(path.join(root, `pages/${page}/index.js`), 'utf8');
      expect(source, page).toContain('captureDataLease');
      expect(source, page).toContain('isDataLeaseCurrent');
    }
  });

  test('does not request phone number or deprecated profile authorization', () => {
    const jsFiles: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'test' || entry.name === 'node_modules') continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(filename);
        else if (path.extname(entry.name) === '.js') jsFiles.push(filename);
      }
    };
    walk(root);

    const source = jsFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/getPhoneNumber|getUserProfile/);
  });

  test('offers optional WeChat avatar and nickname filling only after voluntary login', () => {
    const homeJs = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const mineJs = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
    const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');

    expect(homeJs).toContain('if (!loggedIn) return;');
    expect(homeJs).toContain('this.maybePromptNickname();');
    expect(homeJs).toContain("me.nickname === '微信用户'");
    expect(homeJs).toContain("request('/api/app/me', { method: 'PATCH', data: updates })");
    expect(homeJs).toContain('prepareAvatar(filePath)');
    expect(homeWxml).toContain('open-type="chooseAvatar"');
    expect(homeWxml).toContain('bindchooseavatar="onChooseAvatar"');
    expect(homeWxml).toContain('type="nickname"');
    expect(homeWxml).toContain('name="nickname"');
    expect(homeWxml).toContain('form-type="submit"');
    expect(homeWxml).not.toContain('focus="{{nicknamePromptOn}}"');
    expect(homeWxml).toContain('暂不设置');
    expect(homeWxml).toContain('保存资料');
    expect(homeWxml.indexOf('微信登录并保存记录')).toBeLessThan(homeWxml.indexOf('type="nickname"'));
    expect(mineJs).toContain('await doLogin(this, null, { acceptConsent: true })');
    expect(mineJs).toContain("'/pages/home/index?promptNickname=1'");
    expect(mineWxml).toContain('微信登录并保存记录');
    expect(mineWxml).toContain('consentChecked');
    expect(mineWxml).toContain('open-type="chooseAvatar"');
    expect(mineWxml).toContain('me.avatarUrl');
    expect(mineWxml).toContain('avatar-shell');
    expect(mineWxml).toContain('avatar-trigger');

    const privacyWxml = fs.readFileSync(path.join(root, 'pages/legal/privacy/index.wxml'), 'utf8');
    expect(privacyWxml).toContain('头像和昵称均为可选信息');
    expect(privacyWxml).toContain('不影响记录、查看和统计功能');
  });

  test('downloads authenticated exports and enables legal-domain checks', () => {
    const apiJs = fs.readFileSync(path.join(root, 'utils/api.js'), 'utf8');
    const mineJs = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
    const projectConfig = readJson<{ setting: { urlCheck: boolean } }>('project.config.json');

    expect(apiJs).toContain('wx.downloadFile');
    expect(apiJs).toContain('header.Authorization');
    expect(mineJs).toContain("download('/api/app/export/csv?metric=all')");
    expect(mineJs).toContain('wx.shareFileMessage');
    expect(projectConfig.setting.urlCheck).toBe(true);
  });

  test('wires measurement reminders through one-time subscribe messages', () => {
    const remindersJs = fs.readFileSync(path.join(root, 'utils/reminders.js'), 'utf8');
    const recordJs = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
    const recordWxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8');
    const recordWxss = fs.readFileSync(path.join(root, 'pages/record/index.wxss'), 'utf8');
    const remindersJson = readJson<{ navigationBarTitleText: string }>('pages/reminders/index.json');
    const remindersJsPage = fs.readFileSync(path.join(root, 'pages/reminders/index.js'), 'utf8');
    const remindersWxml = fs.readFileSync(path.join(root, 'pages/reminders/index.wxml'), 'utf8');
    const remindersWxss = fs.readFileSync(path.join(root, 'pages/reminders/index.wxss'), 'utf8');
    const mineJs = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
    const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');
    const homeJs = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const homeWxss = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');

    // Template IDs come from the server, never from the bundle.
    expect(remindersJs).toContain('wx.requestSubscribeMessage');
    expect(remindersJs).toContain("request('/api/app/reminders')");
    expect(remindersJs).toContain("'/api/app/reminders/subscriptions'");
    expect(remindersJs).toContain('MINIPROGRAM_REQUIRED');
    expect(remindersJs).not.toMatch(/qvQ6BOZEl8UZjy1i2hVuu4L0|d_a_7U22lRygaMbZjGjj87Z/);

    // Record page: deep link preselect, quota request at the top of save(), offer banner.
    expect(recordJs).toContain('applyLaunchOptions(options');
    expect(recordJs).toContain('setRecordMetric(metric)');
    expect(recordJs).toContain('this.applyPresetPeriod()');
    expect(recordJs.indexOf('const subscribing = this.requestReminderQuota();')).toBeLessThan(recordJs.indexOf('const saveToken = getToken();'));
    expect(recordJs).toContain('reportSubscriptions(accepted)');
    expect(recordJs).toContain('wasOfferDismissed(metric)');
    expect(recordWxml).toContain('bindtap="enableReminderOffer"');
    expect(recordWxml).toContain('bindtap="dismissReminderOffer"');
    expect(recordWxml).toContain('开启提醒');
    expect(recordWxml).toContain('以后再说');
    expect(recordWxml).toContain('弹出提示时请勾选「总是保持以上选择」，以后就不用每次确认');
    expect(recordWxml.indexOf('class="reminder-offer"')).toBeLessThan(recordWxml.indexOf('class="draft-notice"'));
    expect(recordWxss).toMatch(/\.reminder-offer-help\s*\{[^}]*font-size:\s*26rpx/);
    expect(recordWxss).toMatch(/\.reminder-offer-later\s*\{[^}]*min-height:\s*96rpx/);

    // Settings page.
    expect(remindersJson.navigationBarTitleText).toBe('测量提醒');
    // Card titles are rendered from utils/reminders METRIC_NAMES, so assert the names there and the loop in wxml.
    const remindersUtil = fs.readFileSync(path.join(root, 'utils/reminders.js'), 'utf8');
    expect(remindersUtil).toContain("glucose: '血糖'");
    expect(remindersUtil).toContain("bp: '血压'");
    expect(remindersWxml).toContain('{{item.name}}提醒');
    expect(remindersWxml).toContain('mode="time"');
    expect(remindersWxml).toContain('mode="selector"');
    expect(remindersWxml).toContain('bindtap="toggleReminder"');
    expect(remindersWxml).toContain('bindchange="onTimeChange"');
    expect(remindersWxml).toContain('bindchange="onPeriodChange"');
    expect(remindersWxml).toContain('switch-knob');
    expect(remindersWxml).toContain('每次保存记录时微信会请您确认一次提醒，勾选「总是保持以上选择」以后就不再询问。');
    expect(remindersJsPage).toContain('requestSubscribe(this._state.templates, [card.metric])');
    expect(remindersJsPage).toContain('handleRequestError(this, error, requestToken)');
    expect(remindersWxss).toMatch(/\.reminder-switch\s*\{[^}]*height:\s*96rpx/);
    expect(remindersWxss).toMatch(/\.reminder-row\s*\{[^}]*min-height:\s*104rpx/);

    // Mine cell above the weekly report cell, hidden without templates.
    expect(mineWxml).toContain('测量提醒');
    expect(mineWxml).toContain('bindtap="goReminders"');
    expect(mineWxml).toContain('wx:if="{{remindersAvailable}}"');
    expect(mineWxml.indexOf('测量提醒')).toBeLessThan(mineWxml.indexOf('给家人看近7天记录'));
    expect(mineJs).toContain("wx.navigateTo({ url: '/pages/reminders/index' })");
    expect(mineJs).toContain('planSummary(state.plans)');

    // Home quota row below the streak banner, never in guest mode.
    expect(homeWxml).toContain('明天的提醒还没准备好，点一下就好');
    expect(homeWxml).toContain('bindtap="prepareReminders"');
    expect(homeWxml).toContain('wx:if="{{authed && reminderQuotaEmpty}}"');
    expect(homeWxml.indexOf('streakMessage')).toBeLessThan(homeWxml.indexOf('prepareReminders'));
    expect(homeJs).toContain('quotaEmptyMetrics(state)');
    expect(homeWxss).toMatch(/\.reminder-quota-copy\s*\{[^}]*font-size:\s*26rpx/);
  });

  test('does not expose regulated service wording in uploadable source files', () => {
    const uploadableExtensions = new Set(['.js', '.json', '.wxml', '.wxss']);
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'test') continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(filename);
        else if (uploadableExtensions.has(path.extname(entry.name))) files.push(filename);
      }
    };
    walk(root);

    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    // 用药 / 服药 are now spec-mandated wording for the user's own medication
    // records (docs/WECHAT-MEDICATION-SPEC.md §7); the pharmacy / prescription
    // wording stays banned.
    expect(source).not.toMatch(/药房|药店|购药|处方|低血糖/);
    expect(source).not.toMatch(/多饮水|复查|复测|静坐后/);
  });

  test('wires medication records and reminders within the health-management boundary', () => {
    const medicationsJs = fs.readFileSync(path.join(root, 'utils/medications.js'), 'utf8');
    const remindersJs = fs.readFileSync(path.join(root, 'utils/reminders.js'), 'utf8');
    const pageJson = readJson<{ navigationBarTitleText: string }>('pages/medications/index.json');
    const pageJs = fs.readFileSync(path.join(root, 'pages/medications/index.js'), 'utf8');
    const pageWxml = fs.readFileSync(path.join(root, 'pages/medications/index.wxml'), 'utf8');
    const pageWxss = fs.readFileSync(path.join(root, 'pages/medications/index.wxss'), 'utf8');
    const remindersWxml = fs.readFileSync(path.join(root, 'pages/reminders/index.wxml'), 'utf8');
    const remindersJsPage = fs.readFileSync(path.join(root, 'pages/reminders/index.js'), 'utf8');
    const mineJs = fs.readFileSync(path.join(root, 'pages/mine/index.js'), 'utf8');
    const mineWxml = fs.readFileSync(path.join(root, 'pages/mine/index.wxml'), 'utf8');
    const homeJs = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
    const homeWxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
    const homeWxss = fs.readFileSync(path.join(root, 'pages/home/index.wxss'), 'utf8');
    const recordJs = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8');
    const weeklyJs = fs.readFileSync(path.join(root, 'utils/weekly-report.js'), 'utf8');
    const weeklyWxml = fs.readFileSync(path.join(root, 'pages/weekly-report/index.wxml'), 'utf8');
    const footer = '用药请遵医嘱，本功能只帮您记录和提醒。';

    // Utility contract (spec §5) and fixed copy (spec §7).
    expect(medicationsJs).toContain("request('/api/app/medications')");
    expect(medicationsJs).toContain("'/api/app/medications/checkins'");
    expect(medicationsJs).toContain("MEDICATION_LIMIT_MESSAGE = '常用药最多 8 种'");
    expect(medicationsJs).toContain(`FOOTER_TEXT = '${footer}'`);
    expect(remindersJs).toContain("REMINDER_METRICS = ['glucose', 'bp', 'medication']");
    expect(remindersJs).toContain("medication: '服药'");

    // New page: registered, titled, footer on every state, check-in button with icon + text.
    expect(pageJson.navigationBarTitleText).toBe('我的常用药');
    expect(pageWxml).toContain('今天的药');
    expect(pageWxml).toContain('我的常用药');
    expect(pageWxml).toContain('还没有添加常用药');
    expect(pageWxml).toContain('bindtap="toggleTaken"');
    expect(pageWxml).toContain('bindtap="openAdd"');
    expect(pageWxml).toContain('bindtap="openEdit"');
    expect(pageWxml).toContain('bindtap="removeItem"');
    expect(pageWxml).toContain('bindtap="addTime"');
    expect(pageWxml).toContain('bindtap="removeTime"');
    expect(pageWxml).toContain('bindtap="saveForm"');
    expect(pageWxml).toContain('bindinput="onNameInput"');
    expect(pageWxml).toContain('bindchange="onTimeChange"');
    expect(pageWxml).toContain('maxlength="20"');
    expect(pageWxml).toContain('mode="time"');
    expect(pageWxml).toContain('scroll-into-view="{{scrollTo}}"');
    expect(pageWxml).toContain('id="{{slot.id}}"');
    expect(pageWxml).toContain('{{footerText}}');
    expect(pageWxml.match(/\{\{footerText\}\}/g)).toHaveLength(2);
    expect(pageJs).toContain("'吃了吗？'");
    expect(pageJs).toContain("'已吃'");
    expect(pageJs).toContain("requestSubscribe(this.reminderTemplates(), ['medication'])");
    expect(pageJs).toContain('总是保持以上选择');
    expect(pageJs).toContain("savePlan('medication', { enabled: true })");
    expect(pageJs).toContain('handleRequestError(this, error, requestToken)');
    expect(pageJs.indexOf("const subscribing = requestSubscribe(this.reminderTemplates(), ['medication']);")).toBeLessThan(pageJs.indexOf('await checkin('));
    for (const cssClass of ['.take-btn', '.med-act', '.med-time-remove', '.med-empty-add']) {
      expect(pageWxss, cssClass).toMatch(new RegExp(`\\${cssClass}\\s*\\{[^}]*min-height:\\s*(96|108)rpx`));
    }
    expect(pageWxss).toMatch(/\.take-btn\s*\{[^}]*font-size:\s*28rpx/);
    expect(pageWxss).not.toMatch(/#[0-9A-Fa-f]{6}\b/);

    // Reminders page: third card is a switch only.
    expect(remindersWxml).toContain('wx:if="{{!item.hasTime}}"');
    expect(remindersWxml).toContain('wx:if="{{item.hasTime}}"');
    expect(remindersJsPage).toContain("MEDICATION_SUB_TEXT = '按常用药里的时间提醒'");

    // Mine cell below 测量提醒; home row above the quota row; record quota list.
    expect(mineWxml).toContain('我的常用药');
    expect(mineWxml).toContain('bindtap="goMedications"');
    expect(mineWxml.indexOf('测量提醒')).toBeLessThan(mineWxml.indexOf('我的常用药'));
    expect(mineWxml.indexOf('我的常用药')).toBeLessThan(mineWxml.indexOf('给家人看近7天记录'));
    expect(mineJs).toContain('medicationSummary(state.medications)');
    expect(mineJs).toContain("wx.navigateTo({ url: '/pages/medications/index' })");
    expect(homeWxml).toContain('次药没记，点一下去看看');
    expect(homeWxml).toContain('bindtap="goMedications"');
    expect(homeWxml).toContain('wx:if="{{authed && medicationPending > 0}}"');
    expect(homeWxml.indexOf('streakMessage')).toBeLessThan(homeWxml.indexOf('goMedications'));
    expect(homeWxml.indexOf('goMedications')).toBeLessThan(homeWxml.indexOf('prepareReminders'));
    expect(homeJs).toContain('pendingCount(state.today)');
    // Loaded right after the quota sync in performRefresh, i.e. only when not in guest mode.
    expect(homeJs).toContain('} else {\n      this.syncReminderQuota();\n      this.syncMedicationPending();');
    expect(homeWxss).toMatch(/\.medication-pending\s*\{[^}]*min-height:\s*96rpx/);
    expect(recordJs).toContain('enabledTemplateMetrics(state)');

    // Weekly report line on the canvas and in the page.
    expect(weeklyJs).toContain('本周服药：计划 ${planned} 次，完成 ');
    expect(weeklyJs).toContain('page.medicationText');
    expect(weeklyWxml).toContain('{{medicationText}}');
  });

  test('keeps drug-advice wording out of medication screens and utilities', () => {
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(filename);
        else if (/\.(wxml|js)$/.test(entry.name)) files.push(filename);
      }
    };
    walk(path.join(root, 'pages'));
    walk(path.join(root, 'utils'));

    const banned = /剂量|处方|用法用量|医嘱建议/;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8').replace(/用药请遵医嘱，本功能只帮您记录和提醒。/g, '');
      expect(source, path.relative(root, file)).not.toMatch(banned);
    }
    // 医嘱 itself only appears inside the fixed footer.
    const combined = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(combined.replace(/用药请遵医嘱，本功能只帮您记录和提醒。/g, '')).not.toMatch(/医嘱/);
  });
});
