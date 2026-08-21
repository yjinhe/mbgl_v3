const { getToken, request } = require('../../utils/api');
const { captureDataLease, isDataLeaseCurrent, markRecordsChanged } = require('../../utils/data-cache');
const { decorateRecord, doLogin, ensureLogin, fetchMe } = require('../../utils/page');

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
    const lease = captureDataLease(getToken(), ['records', 'profile']);
    try {
      this.setData({ loading: true });
      const [res, me] = await Promise.all([
        request('/api/app/records/recycle-bin'),
        fetchMe()
      ]);
      if (!isDataLeaseCurrent(lease, getToken())) return;
      const unit = me && me.unit ? me.unit : 'mmol';
      const items = (res.items || []).map((item) => decorateRecord(item.metric, item, unit));
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
      const lease = captureDataLease(getToken(), []);
      await request(`/api/app/records/${metric}/${id}/restore`, { method: 'POST' });
      if (!isDataLeaseCurrent(lease, getToken())) return;
      markRecordsChanged();
      wx.showToast({ title: '已恢复', icon: 'none' });
      this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '恢复失败', icon: 'none' });
    }
  },

  removePermanently(event) {
    const metric = event.currentTarget.dataset.metric;
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '永久删除这条记录？',
      content: '删除后无法恢复，请确认不再需要这条记录。',
      cancelText: '再想想',
      confirmText: '永久删除',
      confirmColor: '#D6453D',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          const lease = captureDataLease(getToken(), []);
          await request(`/api/app/records/${metric}/${id}/permanent`, { method: 'DELETE' });
          if (!isDataLeaseCurrent(lease, getToken())) return;
          markRecordsChanged();
          wx.showToast({ title: '已永久删除', icon: 'none' });
          this.load();
        } catch (error) {
          wx.showToast({ title: error.message || '永久删除失败', icon: 'none' });
        }
      }
    });
  },

  back() {
    wx.navigateBack({ delta: 1 });
  }
});
