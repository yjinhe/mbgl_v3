const { getToken, request } = require('../../utils/api');
const { captureDataLease, isDataLeaseCurrent } = require('../../utils/data-cache');
const { ensureLogin, fetchMe } = require('../../utils/page');
const { demoMe, demoRecords } = require('../../utils/demo');
const { metrics } = require('../../utils/metrics');
const { ensurePlatformPrivacyAuthorization } = require('../../utils/privacy');
const { buildWeeklyPages, drawWeeklyPage } = require('../../utils/weekly-report');

Page({
  data: {
    authed: false, loading: false, generating: false, saving: false, error: '', imageError: '',
    navStyle: '', rangeText: '', totalRecords: 0, pageCount: 0, pageIndex: 0,
    sectionTitle: '', imagePath: '', canvasHeight: 1600
  },

  onLoad() {
    this.setData({ navStyle: getApp().globalData.navStyle });
    this.load();
  },

  onUnload() {
    this._unloaded = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
  },

  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/stats/index' }) }); },

  async load() {
    if (this.data.loading) return;
    const seq = (this._loadSeq || 0) + 1;
    this._loadSeq = seq;
    this._lease = captureDataLease(getToken(), ['records', 'profile']);
    this._images = {};
    this._pages = [];
    this.setData({ loading: true, error: '', imageError: '', imagePath: '', pageCount: 0, totalRecords: 0 });
    try {
      const authed = await ensureLogin(this);
      this.setData({ authed, loading: true });
      let report;
      let me;
      if (authed) {
        [report, me] = await Promise.all([request('/api/app/report/weekly'), fetchMe()]);
      } else {
        const now = new Date();
        report = { from: new Date(now.getTime() - 6 * 86400000).toISOString(), to: now.toISOString(), sections: {} };
        metrics.forEach((metric) => { report.sections[metric.key] = { series: demoRecords(metric.key) }; });
        me = demoMe;
      }
      if (!this.isCurrent(seq)) return;
      const result = buildWeeklyPages(report, { unit: me && me.unit || 'mmol', nickname: me && me.nickname || '', demo: !authed });
      this._pages = result.pages;
      this.setData({ rangeText: result.rangeText, totalRecords: result.totalRecords, pageCount: result.pages.length, pageIndex: 0 });
      if (result.pages.length) await this.renderCurrent();
    } catch (error) {
      if (this.isCurrent(seq)) this.setData({ error: error.message || '记录加载失败，请稍后重试' });
    } finally {
      if (!this._unloaded && seq === this._loadSeq) this.setData({ loading: false });
    }
  },

  isCurrent(seq = this._loadSeq) {
    return !this._unloaded && seq === this._loadSeq && isDataLeaseCurrent(this._lease, getToken());
  },

  async renderCurrent() {
    if (this.data.generating || !this.isCurrent()) return;
    const index = this.data.pageIndex;
    const page = this._pages[index];
    if (!page) return;
    this.setData({ sectionTitle: page.sectionTitle, imagePath: '', imageError: '' });
    if (this._images[index]) { this.setData({ imagePath: this._images[index] }); return; }
    this.setData({ generating: true });
    try {
      await new Promise((resolve) => this.setData({ canvasHeight: page.height }, resolve));
      const ctx = wx.createCanvasContext('weeklyReportCanvas', this);
      drawWeeklyPage(ctx, page);
      await new Promise((resolve) => ctx.draw(false, resolve));
      const image = await new Promise((resolve, reject) => wx.canvasToTempFilePath({
        canvasId: 'weeklyReportCanvas', x: 0, y: 0, width: page.width, height: page.height,
        destWidth: page.width, destHeight: page.height, fileType: 'png', success: resolve, fail: reject
      }, this));
      if (!this.isCurrent()) return;
      this._images[index] = image.tempFilePath;
      if (this.data.pageIndex === index) this.setData({ imagePath: image.tempFilePath });
    } catch (error) {
      if (this.isCurrent()) this.setData({ imageError: '图片生成失败，请点击重试' });
    } finally {
      if (!this._unloaded) this.setData({ generating: false });
    }
  },

  changePage(event) {
    if (this.data.generating) return;
    const index = this.data.pageIndex + Number(event.currentTarget.dataset.step);
    if (index < 0 || index >= this._pages.length) return;
    this.setData({ pageIndex: index }, () => this.renderCurrent());
  },

  preview() {
    if (this.data.imagePath && this.isCurrent()) wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath] });
  },

  shareImage() {
    if (!this.data.imagePath || !this.isCurrent()) return;
    if (typeof wx.showShareImageMenu === 'function' && (typeof wx.canIUse !== 'function' || wx.canIUse('showShareImageMenu'))) {
      wx.showShareImageMenu({ path: this.data.imagePath, fail: (error) => {
        if (!String(error.errMsg || '').includes('cancel')) this.previewForSharing();
      } });
    } else {
      this.previewForSharing();
    }
  },

  previewForSharing() {
    wx.showModal({ title: '长按图片转发', content: '接下来会打开大图，长按图片后选择“发送给朋友”。', showCancel: false, confirmText: '查看图片', success: () => this.preview() });
  },

  async saveImage() {
    if (!this.data.imagePath || this.data.saving || !this.isCurrent()) return;
    this.setData({ saving: true });
    try {
      await ensurePlatformPrivacyAuthorization();
      if (!this.isCurrent()) return;
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: this.data.imagePath, success: resolve, fail: reject }));
      wx.showToast({ title: '这张图片已保存', icon: 'success' });
    } catch (error) {
      const message = String(error.errMsg || '');
      if (/auth deny|auth denied|authorize|permission/i.test(message)) {
        wx.showModal({ title: '需要相册权限', content: '保存图片需要允许访问相册，也可以直接预览或转发图片。', confirmText: '去设置', cancelText: '暂不保存', success: (result) => { if (result.confirm) wx.openSetting({}); } });
      } else if (!message.includes('cancel')) wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally { if (!this._unloaded) this.setData({ saving: false }); }
  },

  goLogin() {
    wx.switchTab({ url: '/pages/mine/index' });
  }
});
