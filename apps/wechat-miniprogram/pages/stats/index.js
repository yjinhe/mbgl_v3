const { getToken, request } = require('../../utils/api');
const { captureDataLease, isDataLeaseCurrent, isPageFresh, markPageFresh } = require('../../utils/data-cache');
const { ensureLogin, fetchMe, friendlyErrorMessage, handleRequestError } = require('../../utils/page');
const { demoStats } = require('../../utils/demo');
const { lipidItems, metrics } = require('../../utils/metrics');
const { PERIOD_FILTERS, buildStatsView, seriesPoints } = require('../../utils/stats-view');
const { consumeStatMetric, syncTabBar } = require('../../utils/tabbar');

const STATS_CACHE_DOMAINS = ['records', 'profile'];

Page({
  data: {
    authed: false, loading: false, error: '',
    metrics: metrics.map((item) => Object.assign({}, item, { className: item.key === 'glucose' ? 'on' : '' })),
    metric: 'glucose', unit: 'mmol', range: 7, range7Class: 'on', range30Class: '', range90Class: '',
    period: 'all', periods: PERIOD_FILTERS.map((item) => Object.assign({}, item, { className: item.key === 'all' ? 'on' : '' })),
    lipidKey: 'tc', lipidOptions: lipidItems.map((item) => Object.assign({}, item, { className: item.key === 'tc' ? 'on' : '' })),
    summary: [], bars: [], visibleRows: [], visibleCount: 0, totalCount: 0, hasMoreRows: false, hasBars: false,
    footnote: '数据仅供个人记录与沟通参考，不作为判断身体状况的依据。', navStyle: ''
  },

  onLoad() { this.setData({ navStyle: getApp().globalData.navStyle }); },

  onShow() {
    syncTabBar(this);
    const selected = consumeStatMetric();
    if (selected && selected !== this.data.metric) return this.setMetricValue(selected);
    if (!this.isDataFresh()) this.load();
  },

  onUnload() { this._loadSeq = (this._loadSeq || 0) + 1; },

  setMetric(event) { this.setMetricValue(event.currentTarget.dataset.metric); },

  setRange(event) {
    const range = Number(event.currentTarget.dataset.range);
    if (![7, 30, 90].includes(range) || range === this.data.range) return;
    this.setData({ range, range7Class: range === 7 ? 'on' : '', range30Class: range === 30 ? 'on' : '', range90Class: range === 90 ? 'on' : '' }, () => this.load());
  },

  setPeriod(event) {
    const period = event.currentTarget.dataset.period;
    if (!PERIOD_FILTERS.some((item) => item.key === period) || period === this.data.period) return;
    this.setData({ period, periods: PERIOD_FILTERS.map((item) => Object.assign({}, item, { className: item.key === period ? 'on' : '' })) }, () => this.load());
  },

  setLipid(event) {
    const lipidKey = event.currentTarget.dataset.key;
    if (!lipidItems.some((item) => item.key === lipidKey) || lipidKey === this.data.lipidKey) return;
    this.setData({ lipidKey, lipidOptions: lipidItems.map((item) => Object.assign({}, item, { className: item.key === lipidKey ? 'on' : '' })) });
    if (this._statsData) this.applyStats(this._statsData, this.data.unit);
  },

  setMetricValue(metric) {
    if (!metrics.some((item) => item.key === metric)) return;
    if (metric === this.data.metric) {
      if (!this.isDataFresh()) this.load();
      return;
    }
    this.setData({ metric, metrics: metrics.map((item) => Object.assign({}, item, { className: item.key === metric ? 'on' : '' })) }, () => this.load());
  },

  async load() {
    const { metric, range, period } = this.data;
    const lease = captureDataLease(getToken(), STATS_CACHE_DOMAINS);
    const key = this.cacheKey();
    const loadingKey = `${key}:${lease.generation}:${lease.versions.records}:${lease.versions.profile}`;
    if (this._loadingKey === loadingKey) return;
    this._loadingKey = loadingKey;
    const loadSeq = (this._loadSeq || 0) + 1;
    this._loadSeq = loadSeq;
    this._statsData = null;
    this._detailRows = [];
    this.setData({ loading: true, error: '', summary: [], bars: [], hasBars: false, visibleRows: [], totalCount: 0, hasMoreRows: false });
    const current = () => loadSeq === this._loadSeq && key === this.cacheKey() && isDataLeaseCurrent(lease, getToken());
    let requestToken = '';
    try {
      if (!(await ensureLogin(this))) {
        if (!current()) return;
        const sample = demoStats(metric, range);
        sample.series = seriesPoints(sample).map((point, index) => Object.assign({}, point, {
          period: metric === 'glucose' ? ['fasting', 'post_meal_1h', 'post_meal_2h'][index % 3] : metric === 'bp' ? 'morning' : undefined,
          dbp: metric === 'bp' ? 78 + index : undefined,
          tc: metric === 'lipid' ? point.value : undefined,
          tg: metric === 'lipid' ? 1.3 + index * 0.1 : undefined,
          ldl: metric === 'lipid' ? 2.7 + index * 0.1 : undefined,
          hdl: metric === 'lipid' ? 1.2 : undefined
        }));
        this.setData({ authed: false, unit: 'mmol' });
        this.applyStats(sample, 'mmol');
        this.markDataFresh(key);
        return;
      }
      requestToken = getToken();
      this.setData({ authed: true });
      const queryPeriod = metric === 'glucose' ? `&period=${period}` : '';
      const [data, me] = await Promise.all([request(`/api/app/stats?metric=${metric}&range=${range}${queryPeriod}`), fetchMe()]);
      if (!current()) return;
      const unit = me && me.unit ? me.unit : 'mmol';
      this.setData({ authed: true, unit });
      this.applyStats(data || {}, unit);
      this.markDataFresh(key);
    } catch (error) {
      if (!current()) return;
      if (handleRequestError(this, error, requestToken)) return;
      this.setData({ error: friendlyErrorMessage(error, '暂时没能加载，请检查网络后重试') });
    } finally {
      if (loadSeq === this._loadSeq) this.setData({ loading: false });
      if (this._loadingKey === loadingKey) this._loadingKey = '';
    }
  },

  applyStats(data, unit) {
    this._statsData = data;
    const view = this.decorate(data, unit);
    this._detailRows = view.detailRows;
    delete view.detailRows;
    this.setData(Object.assign({}, view, { visibleRows: this._detailRows.slice(0, 20), visibleCount: Math.min(20, this._detailRows.length), hasMoreRows: this._detailRows.length > 20 }));
  },

  showMoreRows() {
    const count = Math.min(this.data.visibleCount + 20, this._detailRows.length);
    this.setData({ visibleRows: this._detailRows.slice(0, count), visibleCount: count, hasMoreRows: count < this._detailRows.length });
  },

  decorate(data, unit = this.data.unit) { return buildStatsView(data, { metric: this.data.metric, range: this.data.range, period: this.data.period, lipidKey: this.data.lipidKey, unit }); },

  cacheKey() { return `stats:${this.data.metric}:${this.data.range}:${this.data.metric === 'glucose' ? this.data.period : 'all'}`; },

  isDataFresh() { return !this.data.error && isPageFresh(this, this.cacheKey(), STATS_CACHE_DOMAINS, getToken()); },

  markDataFresh(key = this.cacheKey()) { markPageFresh(this, key, STATS_CACHE_DOMAINS, getToken()); },

  openWeeklyReport() { wx.navigateTo({ url: '/pages/weekly-report/index' }); }
});
