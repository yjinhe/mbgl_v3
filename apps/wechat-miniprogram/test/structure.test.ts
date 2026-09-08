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
    expect(source).not.toMatch(/药房|药店|用药|服药|购药|处方|低血糖/);
    expect(source).not.toMatch(/多饮水|复查|复测|静坐后/);
  });
});
