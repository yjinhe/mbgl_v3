const { download, getToken, request } = require('../../utils/api');
const { prepareAvatar } = require('../../utils/avatar');
const {
  captureDataLease,
  isDataLeaseCurrent,
  isPageFresh,
  markPageFresh,
  markProfileChanged
} = require('../../utils/data-cache');
const { doLogin, loadMe, logoutToLogin } = require('../../utils/page');
const { hasConsent, openPrivacyContract } = require('../../utils/privacy');
const { hasTemplates, loadReminders, planSummary } = require('../../utils/reminders');
const { loadMedications, medicationSummary } = require('../../utils/medications');
const { syncTabBar } = require('../../utils/tabbar');

const MINE_CACHE_DOMAINS = ['records', 'profile'];

function shareFile(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx.shareFileMessage !== 'function') {
      reject(new Error('当前微信版本暂不支持分享文件，请升级微信后重试'));
      return;
    }
    wx.shareFileMessage({
      filePath,
      fileName: '糖迹-全部健康记录.zip',
      success: resolve,
      fail: reject
    });
  });
}

Page({
  data: {
    authed: false,
    loading: false,
    me: null,
    sexMale: false,
    sexFemale: false,
    unitMmol: true,
    unitMgdl: false,
    sexMaleClass: '',
    sexFemaleClass: '',
    unitMmolClass: 'on',
    unitMgdlClass: '',
    deletingAccount: false,
    exporting: false,
    updatingAvatar: false,
    consentChecked: false,
    remindersAvailable: false,
    reminderSummary: '未开启',
    medicationSummary: '未添加',
    navStyle: ''
  },

  onLoad() {
    this.setData({
      navStyle: getApp().globalData.navStyle,
      consentChecked: hasConsent()
    });
  },

  onShow() {
    syncTabBar(this);
    if (!this.isDataFresh()) {
      this.refresh();
      return;
    }
    // The reminders page invalidates its cache after every change, so this
    // is cheap when nothing changed and current when something did.
    if (this.data.authed) {
      this.loadReminderSummary();
      this.loadMedicationSummary();
    }
  },

  // Sub text for the "测量提醒" cell; the cell is hidden when the server
  // has no templates configured (spec §7).
  loadReminderSummary() {
    const token = getToken();
    if (!token) {
      if (this.data.remindersAvailable) this.setData({ remindersAvailable: false, reminderSummary: '未开启' });
      return Promise.resolve(null);
    }
    return loadReminders().then((state) => {
      if (getToken() !== token) return null;
      this.setData({
        remindersAvailable: hasTemplates(state.templates),
        reminderSummary: planSummary(state.plans)
      });
      return state;
    }).catch(() => null);
  },

  goReminders() {
    wx.navigateTo({ url: '/pages/reminders/index' });
  },

  // Sub text for the "我的常用药" cell: 'N 种' or '未添加'. The medications
  // page invalidates its cache after every change.
  loadMedicationSummary() {
    const token = getToken();
    if (!token) return Promise.resolve(null);
    return loadMedications().then((state) => {
      if (getToken() !== token) return null;
      const summary = medicationSummary(state.medications);
      if (summary !== this.data.medicationSummary) this.setData({ medicationSummary: summary });
      return state;
    }).catch(() => null);
  },

  goMedications() {
    wx.navigateTo({ url: '/pages/medications/index' });
  },

  async login() {
    if (!this.data.consentChecked) {
      wx.showToast({ title: '请先阅读并同意用户协议和隐私政策', icon: 'none' });
      return;
    }
    const loggedIn = await doLogin(this, null, { acceptConsent: true });
    if (loggedIn) wx.reLaunch({ url: '/pages/home/index?promptNickname=1' });
  },

  toggleConsent() {
    this.setData({ consentChecked: !this.data.consentChecked });
  },

  async refresh() {
    const lease = captureDataLease(getToken(), MINE_CACHE_DOMAINS);
    const me = await loadMe(this, { apply: false });
    if (me === false || !isDataLeaseCurrent(lease, getToken())) return;
    if (!me) {
      if (this.data.authed || this.data.loading || this.data.me) {
        this.setData({ authed: false, loading: false, me: null, remindersAvailable: false, reminderSummary: '未开启', medicationSummary: '未添加' });
      }
      this.markDataFresh();
      return;
    }
    this.applyMe(me);
    this.markDataFresh();
    this.loadReminderSummary();
    this.loadMedicationSummary();
  },

  applyMe(me) {
    this.setData({
      authed: true,
      me,
      sexMale: me.sex === 'male',
      sexFemale: me.sex === 'female',
      unitMmol: me.unit !== 'mgdl',
      unitMgdl: me.unit === 'mgdl',
      sexMaleClass: me.sex === 'male' ? 'on' : '',
      sexFemaleClass: me.sex === 'female' ? 'on' : '',
      unitMmolClass: me.unit !== 'mgdl' ? 'on' : '',
      unitMgdlClass: me.unit === 'mgdl' ? 'on' : ''
    });
  },

  isDataFresh() {
    return isPageFresh(this, 'mine', MINE_CACHE_DOMAINS, getToken());
  },

  markDataFresh() {
    markPageFresh(this, 'mine', MINE_CACHE_DOMAINS, getToken());
  },

  async patch(event) {
    const key = event.currentTarget.dataset.key;
    const value = event.currentTarget.dataset.value;
    const lease = captureDataLease(getToken(), []);
    try {
      const applied = await this.runProfileMutation(async () => {
        if (!isDataLeaseCurrent(lease, getToken())) return false;
        const updated = await request('/api/app/me', { method: 'PATCH', data: { [key]: value } });
        if (!isDataLeaseCurrent(lease, getToken())) return false;
        const me = Object.assign({}, this.data.me, updated || {}, { [key]: value });
        markProfileChanged(getToken(), me);
        this.applyMe(me);
        this.markDataFresh();
        return true;
      });
      if (!applied) return;
      wx.showToast({ title: '已更新', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' });
    }
  },

  async onChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.updatingAvatar) return;
    const lease = captureDataLease(getToken(), []);
    try {
      this.setData({ updatingAvatar: true });
      const avatarUrl = await prepareAvatar(filePath);
      if (!isDataLeaseCurrent(lease, getToken())) return;
      const applied = await this.runProfileMutation(async () => {
        if (!isDataLeaseCurrent(lease, getToken())) return false;
        const updated = await request('/api/app/me', { method: 'PATCH', data: { avatarUrl } });
        if (!isDataLeaseCurrent(lease, getToken())) return false;
        const me = Object.assign({}, this.data.me, updated || {}, {
          avatarUrl: (updated && updated.avatarUrl) || avatarUrl
        });
        markProfileChanged(getToken(), me);
        this.applyMe(me);
        this.markDataFresh();
        return true;
      });
      if (!applied) return;
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '头像更新失败', icon: 'none' });
    } finally {
      this.setData({ updatingAvatar: false });
    }
  },

  goRecycle() {
    wx.navigateTo({ url: '/pages/recycle/index' });
  },

  goWeeklyReport() {
    wx.navigateTo({ url: '/pages/weekly-report/index' });
  },

  goTerms() {
    wx.navigateTo({ url: '/pages/legal/terms/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/privacy/index' });
  },

  openWechatPrivacy() {
    openPrivacyContract();
  },

  async exportAll() {
    if (this.data.exporting) return;
    const lease = captureDataLease(getToken(), []);
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在导出', mask: true });
    try {
      const file = await download('/api/app/export/csv?metric=all');
      wx.hideLoading();
      if (!isDataLeaseCurrent(lease, getToken())) return;
      await shareFile(file.tempFilePath);
    } catch (error) {
      wx.hideLoading();
      if (!String(error && error.errMsg || '').includes('cancel')) {
        wx.showToast({ title: error.message || '导出失败，请稍后重试', icon: 'none' });
      }
    } finally {
      this.setData({ exporting: false });
    }
  },

  logout() {
    logoutToLogin(this);
    wx.reLaunch({ url: '/pages/home/index' });
  },

  async runProfileMutation(operation) {
    const previous = this._profileMutation || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this._profileMutation = current;
    try {
      return await current;
    } finally {
      if (this._profileMutation === current) this._profileMutation = null;
    }
  },

  deleteAccount() {
    if (this.data.deletingAccount) return;

    const totalRecords = Number(this.data.me && this.data.me.stats && this.data.me.stats.totalRecords);
    const recordCount = Number.isFinite(totalRecords) ? totalRecords : 0;
    this.setData({ deletingAccount: true });

    wx.showModal({
      title: '注销并删除全部数据？',
      content: `将删除账号下全部 ${recordCount} 条健康记录及关联数据（四类指标合计），该操作不可恢复。如需留底，请先导出数据。`,
      cancelText: '再想想',
      confirmText: '确认注销',
      confirmColor: '#D6453D',
      success: async (res) => {
        if (!res.confirm) {
          this.setData({ deletingAccount: false });
          return;
        }

        try {
          const lease = captureDataLease(getToken(), []);
          await request('/api/app/me', { method: 'DELETE' });
          if (!isDataLeaseCurrent(lease, getToken())) {
            this.setData({ deletingAccount: false });
            return;
          }
          logoutToLogin(this);
          this.setData({ deletingAccount: false });
          wx.showToast({ title: '账号已注销', icon: 'none' });
          wx.reLaunch({ url: '/pages/home/index' });
        } catch (error) {
          this.setData({ deletingAccount: false });
          wx.showModal({
            title: '注销失败',
            content: error && error.message
              ? `未能注销账号：${error.message}`
              : '未能注销账号，请检查网络后重试。',
            showCancel: false,
            confirmText: '知道了'
          });
        }
      },
      fail: () => {
        this.setData({ deletingAccount: false });
        wx.showToast({ title: '无法打开注销确认，请稍后重试', icon: 'none' });
      }
    });
  }
});
