const { request } = require('../../utils/api');
const { doLogin, ensureLogin } = require('../../utils/page');

Page({
  data: {
    authed: true,
    loading: false,
    code: '',
    preview: null,
    navStyle: ''
  },

  onLoad(options) {
    this.setData({ navStyle: getApp().globalData.navStyle });
    if (options && options.code) this.setData({ code: String(options.code).toUpperCase() });
  },

  onShow() {
    ensureLogin(this);
  },

  async login() {
    await doLogin(this, () => ensureLogin(this));
  },

  onCodeInput(event) {
    this.setData({ code: String(event.detail.value || '').toUpperCase() });
  },

  async query() {
    if (!this.data.code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' });
      return;
    }
    try {
      this.setData({ loading: true });
      const preview = await request(`/api/app/pharmacy/invite/${this.data.code}`);
      this.setData({ preview });
    } catch (error) {
      this.setData({ preview: null });
      wx.showToast({ title: error.message || '邀请码无效或已过期', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  bindPharmacy() {
    if (!this.data.preview) return;
    wx.showModal({
      title: '授权数据查看',
      content: `绑定「${this.data.preview.pharmacyName}」后，该药房的工作人员将可以查看你在糖迹记录的全部健康数据（血糖、血压、血脂、尿酸），用于为你提供用药提醒与健康管理服务。你可以随时在「我的 → 服务药房」解绑，解绑后立即终止其全部访问（含历史数据）。`,
      confirmText: '同意并绑定',
      confirmColor: '#0E7E6B',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request('/api/app/pharmacy/bind', { method: 'POST', data: { code: this.data.code } });
          wx.showToast({ title: '已绑定', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 600);
        } catch (error) {
          wx.showToast({ title: error.message || '绑定失败', icon: 'none' });
        }
      }
    });
  },

  back() {
    wx.navigateBack({ delta: 1 });
  }
});
