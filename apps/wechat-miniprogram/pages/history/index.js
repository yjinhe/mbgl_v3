const { getToken, request } = require('../../utils/api');
const {
  captureDataLease,
  isDataLeaseCurrent,
  isPageFresh,
  markPageFresh,
  markRecordsChanged
} = require('../../utils/data-cache');
const { ensureLogin, decorateRecord, fetchMe, friendlyErrorMessage, handleRequestError } = require('../../utils/page');
const { demoRecords } = require('../../utils/demo');
const { metrics } = require('../../utils/metrics');
const { setRecordEdit, setRecordReturnPath, syncTabBar } = require('../../utils/tabbar');

const HISTORY_CACHE_DOMAINS = ['records', 'profile'];

Page({
  data: {
    authed: false,
    loading: false,
    error: '',
    metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === 'glucose', className: item.key === 'glucose' ? 'on' : '' })),
    metric: 'glucose',
    unit: 'mmol',
    records: [],
    nextCursor: null,
    hasRecords: false,
    navStyle: ''
  },

  onLoad() {
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  onShow() {
    syncTabBar(this);
    if (!this.isDataFresh()) this.load();
  },

  setMetric(event) {
    const metric = event.currentTarget.dataset.metric;
    if (!metric || metric === this.data.metric) return;
    this.setData({
      metric,
      records: [],
      nextCursor: null,
      hasRecords: false,
      error: '',
      loading: true,
      metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === metric, className: item.key === metric ? 'on' : '' }))
    }, () => this.load(true));
  },

  async load(reset = true) {
    const metric = this.data.metric;
    const cursor = reset ? null : this.data.nextCursor;
    const lease = captureDataLease(getToken(), HISTORY_CACHE_DOMAINS);
    const loadingKey = `history:${metric}:${cursor || 'first'}:${lease.generation}:${lease.versions.records}:${lease.versions.profile}`;
    if (this._loadingKey === loadingKey) return;
    this._loadingKey = loadingKey;
    const loadSeq = (this._loadSeq || 0) + 1;
    this._loadSeq = loadSeq;
    this.setData(Object.assign({ loading: true, error: '' }, reset ? { records: [], hasRecords: false, nextCursor: null } : {}));
    let requestToken = '';
    try {
      if (!(await ensureLogin(this))) {
        if (loadSeq !== this._loadSeq || metric !== this.data.metric || !isDataLeaseCurrent(lease, getToken())) return;
        const records = demoRecords(metric).map((item) => decorateRecord(metric, item));
        this.setData({ records, nextCursor: null, hasRecords: records.length > 0, authed: false, loading: false, error: '' });
        this.markDataFresh(metric);
        return;
      }
      requestToken = getToken();
      this.setData({ loading: true });
      const query = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
      const [res, me] = await Promise.all([
        request(`/api/app/records/${metric}${query}`),
        fetchMe()
      ]);
      if (loadSeq !== this._loadSeq || metric !== this.data.metric || !isDataLeaseCurrent(lease, getToken())) return;
      const unit = me && me.unit ? me.unit : 'mmol';
      const incoming = (res.items || []).map((item) => decorateRecord(metric, item, unit));
      const records = reset ? incoming : this.data.records.concat(incoming);
      this.setData({ records, unit, nextCursor: res.nextCursor || null, hasRecords: records.length > 0, authed: true, error: '' });
      this.markDataFresh(metric);
    } catch (error) {
      if (loadSeq === this._loadSeq && metric === this.data.metric && isDataLeaseCurrent(lease, getToken())) {
        if (handleRequestError(this, error, requestToken)) return;
        this.setData({ error: friendlyErrorMessage(error, '加载失败，请重试') });
      }
    } finally {
      if (loadSeq === this._loadSeq) this.setData({ loading: false });
      if (this._loadingKey === loadingKey) this._loadingKey = '';
    }
  },

  loadMore() {
    if (!this.data.loading && this.data.nextCursor) this.load(false);
  },

  retry() {
    this.load(!this.data.hasRecords);
  },

  edit(event) {
    if (!this.data.authed || this.data.loading) return;
    const record = this.data.records.find((item) => item.id === event.currentTarget.dataset.id);
    if (!record) return;
    setRecordEdit(this.data.metric, record, getToken());
    setRecordReturnPath('/pages/history/index');
    wx.switchTab({
      url: '/pages/record/index',
      fail: () => {
        setRecordEdit('', null, '');
        wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' });
      }
    });
  },

  isDataFresh() {
    return !this.data.error && isPageFresh(this, `history:${this.data.metric}`, HISTORY_CACHE_DOMAINS, getToken());
  },

  markDataFresh(metric = this.data.metric) {
    markPageFresh(this, `history:${metric}`, HISTORY_CACHE_DOMAINS, getToken());
  },

  async remove(event) {
    if (!this.data.authed) return;
    const id = event.currentTarget.dataset.id;
    const metric = this.data.metric;
    const lease = captureDataLease(getToken(), []);
    wx.showModal({
      title: '删除记录？',
      content: '删除后 7 天内可在回收站找回。',
      confirmText: '删除',
      confirmColor: '#D6453D',
      success: async (res) => {
        if (!res.confirm) return;
        if (!isDataLeaseCurrent(lease, getToken())) return;
        try {
          await request(`/api/app/records/${metric}/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!isDataLeaseCurrent(lease, getToken())) return;
          markRecordsChanged();
          wx.showToast({ title: '已删除', icon: 'none' });
          this.load(true);
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败', icon: 'none' });
        }
      }
    });
  }
});
