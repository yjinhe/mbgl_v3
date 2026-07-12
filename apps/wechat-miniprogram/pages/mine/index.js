const { request } = require('../../utils/api');
const { doLogin, loadAppData, logoutToLogin } = require('../../utils/page');
const { fmtMD } = require('../../utils/format');

Page({
  data: {
    authed: true,
    loading: false,
    me: null,
    bindingText: '',
    sexMale: false,
    sexFemale: false,
    unitMmol: true,
    unitMgdl: false,
    sexMaleClass: '',
    sexFemaleClass: '',
    unitMmolClass: 'on',
    unitMgdlClass: '',
    deletingAccount: false,
    navStyle: ''
  },

  onLoad() {
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  onShow() {
    this.refresh();
  },

  async login() {
    await doLogin(this, () => this.refresh());
  },

  async refresh() {
    const data = await loadAppData(this);
    if (!data || !data.me) return;
    const me = data.me;
    this.setData({
      bindingText: me.binding ? `${fmtMD(me.binding.boundAt)} 起 · 该药房可查看你的健康记录` : '',
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

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' });
  },

  goRecycle() {
    wx.navigateTo({ url: '/pages/recycle/index' });
  },

  unbind() {
    if (!this.data.me || !this.data.me.binding) return;
    wx.showModal({
      title: `解除与「${this.data.me.binding.pharmacyName}」的绑定？`,
      content: '解绑后该药房将立即无法查看你的任何记录（含历史数据）。如需再次获得服务，可重新输入邀请码绑定。',
      confirmText: '确认解绑',
      confirmColor: '#D6453D',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request('/api/app/pharmacy/bind', { method: 'DELETE' });
          wx.showToast({ title: '已解绑', icon: 'none' });
          this.refresh();
        } catch (error) {
          wx.showToast({ title: error.message || '解绑失败', icon: 'none' });
        }
      }
    });
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
