const { download, request } = require('../../utils/api');
const { loadAppData, logoutToLogin } = require('../../utils/page');
const { openPrivacyContract } = require('../../utils/privacy');

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
    navStyle: ''
  },

  onLoad() {
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  onShow() {
    this.refresh();
  },

  login() {
    wx.reLaunch({ url: '/pages/home/index' });
  },

  async refresh() {
    const data = await loadAppData(this);
    if (!data || !data.me) {
      this.setData({ authed: false, loading: false });
      return;
    }
    const me = data.me;
    this.setData({
      authed: true,
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

  async patch(event) {
    const key = event.currentTarget.dataset.key;
    const value = event.currentTarget.dataset.value;
    try {
      await request('/api/app/me', { method: 'PATCH', data: { [key]: value } });
      wx.showToast({ title: '已更新', icon: 'none' });
      this.refresh();
    } catch (error) {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' });
    }
  },

  goRecycle() {
    wx.navigateTo({ url: '/pages/recycle/index' });
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
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在导出', mask: true });
    try {
      const file = await download('/api/app/export/csv?metric=all');
      wx.hideLoading();
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
          await request('/api/app/me', { method: 'DELETE' });
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
  },

  switchPage(event) {
    const tab = event.currentTarget.dataset.tab;
    const urlMap = {
      home: '/pages/home/index',
      history: '/pages/history/index',
      record: '/pages/record/index',
      stats: '/pages/stats/index',
      mine: '/pages/mine/index'
    };
    if (tab === 'mine') return;
    wx.redirectTo({ url: urlMap[tab] });
  }
});
