const { request } = require('../../utils/api');
const { doLogin, ensureLogin } = require('../../utils/page');
const { metrics } = require('../../utils/metrics');

Page({
  data: {
    authed: true,
    loading: false,
    metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === 'glucose', className: item.key === 'glucose' ? 'on' : '' })),
    metric: 'glucose',
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
    const selected = wx.getStorageSync('tangji_stat_metric') || this.data.metric;
    wx.removeStorageSync('tangji_stat_metric');
    this.setMetricValue(selected);
  },

  async login() {
    await doLogin(this, () => this.load());
  },

  setMetric(event) {
    this.setMetricValue(event.currentTarget.dataset.metric);
  },

  setRange(event) {
    const range = Number(event.currentTarget.dataset.range);
    this.setData({
      range,
      range7Class: range === 7 ? 'on' : '',
      range30Class: range === 30 ? 'on' : '',
      range90Class: range === 90 ? 'on' : ''
    }, () => this.load());
  },

  setMetricValue(metric) {
    this.setData({
      metric,
      metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === metric, className: item.key === metric ? 'on' : '' }))
    }, () => this.load());
  },

  async load() {
    if (!(await ensureLogin(this))) return;
    try {
      this.setData({ loading: true });
      const data = await request(`/api/app/stats?metric=${this.data.metric}&range=${this.data.range}`);
      this.setData(this.decorate(data || {}));
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  decorate(data) {
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
      return {
        summary: [
          { label: '记录数', value: data.n || 0, unit: '次' },
          { label: '平均血糖', value: this.safeFixed(data.avg), unit: 'mmol/L' },
          { label: '最高', value: this.safeFixed(data.max), unit: '' },
          { label: '最低', value: this.safeFixed(data.min), unit: '' }
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
          { label: 'TC', value: latest.tc || '—', unit: '' },
          { label: 'TG', value: latest.tg || '—', unit: '' },
          { label: 'LDL-C', value: latest.ldl || '—', unit: '' }
        ],
        bars,
        hasBars: bars.length > 0
      };
    }
    return {
      summary: [
        { label: '记录数', value: data.n || 0, unit: '次' },
        { label: '最近一次', value: data.latest ? data.latest.value : '—', unit: 'μmol/L' },
        { label: '平均', value: Math.round(data.avg || 0), unit: '' },
        { label: '达标率', value: Math.round((data.okRate || 0) * 100), unit: '%' }
      ],
      bars,
      hasBars: bars.length > 0
    };
  },

  safeFixed(value) {
    return value == null ? '—' : Number(value).toFixed(1);
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
    if (tab === 'stats') return;
    wx.redirectTo({ url: urlMap[tab] });
  }
});
