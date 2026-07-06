const { request } = require('../../utils/api');
const { decorateRecord, doLogin, ensureLogin } = require('../../utils/page');

Page({
  data: {
    authed: true,
    loading: false,
    items: [],
    hasItems: false,
    navStyle: ''
  },

  onLoad() {
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  onShow() {
    this.load();
  },

  async login() {
    await doLogin(this, () => this.load());
  },

  async load() {
    if (!(await ensureLogin(this))) return;
    try {
      this.setData({ loading: true });
      const res = await request('/api/app/records/recycle-bin');
      const items = (res.items || []).map((item) => decorateRecord(item.metric, item));
      this.setData({ items, hasItems: items.length > 0 });
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async restore(event) {
    const metric = event.currentTarget.dataset.metric;
    const id = event.currentTarget.dataset.id;
    try {
      await request(`/api/app/records/${metric}/${id}/restore`, { method: 'POST' });
      wx.showToast({ title: '已恢复', icon: 'none' });
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '恢复失败', icon: 'none' });
    }
  },

  back() {
    wx.navigateBack({ delta: 1 });
  }
});
