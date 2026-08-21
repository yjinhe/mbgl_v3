const { getToken, request } = require('../../utils/api');
const {
  captureDataLease,
  isDataLeaseCurrent,
  isPageFresh,
  markPageFresh
} = require('../../utils/data-cache');
const { ensureLogin, fetchMe } = require('../../utils/page');
const { demoStats } = require('../../utils/demo');
const { displayGlucoseValue, glucoseUnitText, metrics } = require('../../utils/metrics');
const { consumeStatMetric, syncTabBar } = require('../../utils/tabbar');

const STATS_CACHE_DOMAINS = ['records', 'profile'];

Page({
  data: {
    authed: false,
    loading: false,
    metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === 'glucose', className: item.key === 'glucose' ? 'on' : '' })),
    metric: 'glucose',
    unit: 'mmol',
    range: 7,
    range7Class: 'on',
    range30Class: '',
    range90Class: '',
    summary: [],
    bars: [],
    hasBars: false,
    footnote: '数据统计仅供个人记录参考，不作为判断身体状况的依据。',
    navStyle: ''
  },

  onLoad() {
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  onShow() {
    syncTabBar(this);
    const selected = consumeStatMetric();
    if (selected && selected !== this.data.metric) {
      this.setMetricValue(selected);
      return;
    }
    if (!this.isDataFresh()) this.load();
  },

  setMetric(event) {
    this.setMetricValue(event.currentTarget.dataset.metric);
  },

  setRange(event) {
    const range = Number(event.currentTarget.dataset.range);
    if (!range || range === this.data.range) return;
    this.setData({
      range,
      range7Class: range === 7 ? 'on' : '',
      range30Class: range === 30 ? 'on' : '',
      range90Class: range === 90 ? 'on' : ''
    }, () => this.load());
  },

  setMetricValue(metric) {
    if (!metric) return;
    if (metric === this.data.metric) {
      if (!this.isDataFresh()) this.load();
      return;
    }
    this.setData({
      metric,
      metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === metric, className: item.key === metric ? 'on' : '' }))
    }, () => this.load());
  },

  async load() {
    const metric = this.data.metric;
    const range = this.data.range;
    const lease = captureDataLease(getToken(), STATS_CACHE_DOMAINS);
    const loadingKey = `${this.cacheKey(metric, range)}:${lease.generation}:${lease.versions.records}:${lease.versions.profile}`;
    if (this._loadingKey === loadingKey) return;
    this._loadingKey = loadingKey;
    const loadSeq = (this._loadSeq || 0) + 1;
    this._loadSeq = loadSeq;
    try {
      if (!(await ensureLogin(this))) {
        if (loadSeq !== this._loadSeq || !isDataLeaseCurrent(lease, getToken())) return;
        this.setData(Object.assign({ authed: false, loading: false, unit: 'mmol' }, this.decorate(demoStats(metric, range), 'mmol')));
        this.markDataFresh(metric, range);
        return;
      }
      const [data, me] = await Promise.all([
        request(`/api/app/stats?metric=${metric}&range=${range}`),
        fetchMe()
      ]);
      if (
        loadSeq !== this._loadSeq
          || metric !== this.data.metric
          || range !== this.data.range
          || !isDataLeaseCurrent(lease, getToken())
      ) return;
      const unit = me && me.unit ? me.unit : 'mmol';
      this.setData(Object.assign({ authed: true, unit }, this.decorate(data || {}, unit)));
      this.markDataFresh(metric, range);
    } catch (error) {
      if (loadSeq === this._loadSeq) {
        wx.showToast({ title: error.message || '加载失败', icon: 'none' });
      }
    } finally {
      if (this._loadingKey === loadingKey) this._loadingKey = '';
    }
  },

  cacheKey(metric = this.data.metric, range = this.data.range) {
    return `stats:${metric}:${range}`;
  },

  isDataFresh() {
    return isPageFresh(this, this.cacheKey(), STATS_CACHE_DOMAINS, getToken());
  },

  markDataFresh(metric = this.data.metric, range = this.data.range) {
    markPageFresh(this, this.cacheKey(metric, range), STATS_CACHE_DOMAINS, getToken());
  },

  decorate(data, unit = this.data.unit) {
    const metric = this.data.metric;
    const points = (data.series && (data.series.points || data.series)) || [];
    const bars = Array.isArray(points)
      ? points.slice(-14).map((point, index) => {
        const raw = point.valueMmol || point.avg || point.value || point.sbp || point.v || 0;
        const height = Math.max(18, Math.min(150, Number(raw) * (metric === 'bp' ? 0.7 : metric === 'uric' ? 0.18 : 10)));
        return { id: `${point.measuredAt || point.date || index}`, height };
      })
      : [];

    if (metric === 'glucose') {
      const unitText = glucoseUnitText(unit);
      return {
        summary: [
          { label: '记录数', value: data.n || 0, unit: '次' },
          { label: '平均血糖', value: displayGlucoseValue(data.avg, unit), unit: unitText },
          { label: '最高', value: displayGlucoseValue(data.max, unit), unit: unitText },
          { label: '最低', value: displayGlucoseValue(data.min, unit), unit: unitText }
        ],
        bars,
        hasBars: bars.length > 0
      };
    }
    if (metric === 'bp') {
      return {
        summary: [
          { label: '记录数', value: data.n || 0, unit: '次' },
          { label: '平均收缩压', value: Math.round(data.avgSbp || 0), unit: 'mmHg' },
          { label: '平均舒张压', value: Math.round(data.avgDbp || 0), unit: 'mmHg' },
          { label: '达标率', value: Math.round((data.okRate || 0) * 100), unit: '%' }
        ],
        bars,
        hasBars: bars.length > 0
      };
    }
    if (metric === 'lipid') {
      const latest = data.latest || {};
      return {
        summary: [
          { label: '化验次数', value: data.n || 0, unit: '次' },
          { label: 'TC', value: latest.tc || '—', unit: 'mmol/L' },
          { label: 'TG', value: latest.tg || '—', unit: 'mmol/L' },
          { label: 'LDL-C', value: latest.ldl || '—', unit: 'mmol/L' }
        ],
        bars,
        hasBars: bars.length > 0
      };
    }
    return {
      summary: [
        { label: '记录数', value: data.n || 0, unit: '次' },
        { label: '最近一次', value: data.latest ? data.latest.value : '—', unit: 'μmol/L' },
        { label: '平均', value: Math.round(data.avg || 0), unit: 'μmol/L' },
        { label: '达标率', value: Math.round((data.okRate || 0) * 100), unit: '%' }
      ],
      bars,
      hasBars: bars.length > 0
    };
  },

  safeFixed(value) {
    return value == null ? '—' : Number(value).toFixed(1);
  }
});
