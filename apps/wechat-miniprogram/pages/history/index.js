const { request } = require('../../utils/api');
const { doLogin, ensureLogin, decorateRecord } = require('../../utils/page');
const { metrics } = require('../../utils/metrics');

Page({
  data: {
    authed: true,
    loading: false,
    metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === 'glucose', className: item.key === 'glucose' ? 'on' : '' })),
    metric: 'glucose',
    records: [],
    hasRecords: false,
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

  setMetric(event) {
    const metric = event.currentTarget.dataset.metric;
    this.setData({
      metric,
      metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === metric, className: item.key === metric ? 'on' : '' }))
    }, () => this.load());
  },

  async load() {
    if (!(await ensureLogin(this))) return;
    try {
      this.setData({ loading: true });
      const res = await request(`/api/app/records/${this.data.metric}`);
      const records = (res.items || []).map((item) => decorateRecord(this.data.metric, item));
      this.setData({ records, hasRecords: records.length > 0, authed: true });
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async remove(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录？',
      content: '删除后 7 天内可在回收站找回。',
      confirmText: '删除',
      confirmColor: '#D6453D',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request(`/api/app/records/${this.data.metric}/${id}`, { method: 'DELETE' });
          wx.showToast({ title: '已删除', icon: 'none' });
          this.load();
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败', icon: 'none' });
        }
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
    if (tab === 'history') return;
    wx.redirectTo({ url: urlMap[tab] });
  }
});
