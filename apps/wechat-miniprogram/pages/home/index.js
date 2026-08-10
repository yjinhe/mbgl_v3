const { doLogin, loadAppData } = require('../../utils/page');
const { demoMe, demoOverview } = require('../../utils/demo');
const { hasConsent } = require('../../utils/privacy');
const { fmtMD, fmtTime, dayLabel, greetingAt, localDateLine } = require('../../utils/format');
const { metrics, neutralStatusLabel, statusClass, statusStyle, periodNames } = require('../../utils/metrics');

Page({
  data: {
    authed: false,
    loading: true,
    greeting: greetingAt(),
    dateLine: localDateLine(),
    me: null,
    overview: null,
    cards: [],
    consentChecked: false,
    tab: 'home',
    homeOn: 'on',
    historyOn: '',
    statsOn: '',
    mineOn: '',
    navStyle: ''
  },

  onLoad() {
    this.setData({
      navStyle: getApp().globalData.navStyle,
      consentChecked: hasConsent()
    });
  },

  onShow() {
    this.refresh();
  },

  async login() {
    if (!this.data.consentChecked) {
      wx.showToast({ title: '请先阅读并同意用户协议和隐私政策', icon: 'none' });
      return;
    }
    await doLogin(this, () => this.refresh(), { acceptConsent: true });
  },

  toggleConsent() {
    this.setData({ consentChecked: !this.data.consentChecked });
  },

  goTerms() {
    wx.navigateTo({ url: '/pages/legal/terms/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/privacy/index' });
  },

  async refresh() {
    const data = await loadAppData(this);
    const isDemo = !data;
    const overview = isDemo ? demoOverview() : (data.overview || {});
    const me = isDemo ? demoMe : (data.me || {});
    const cards = metrics.map((metric) => this.decorateMetric(metric, overview[metric.key], me));
    this.setData({
      authed: !isDemo,
      loading: false,
      greeting: greetingAt(),
      dateLine: localDateLine(),
      todayCount: overview.todayCount || 0,
      streak: overview.streak || 0,
      cards
    });
  },

  decorateMetric(metric, entry, me) {
    const latest = entry && entry.latest;
    if (!latest) {
      return {
        key: metric.key,
        name: metric.name,
        unit: metric.unit,
        color: metric.color,
        soft: metric.soft,
        softStyle: `background:${metric.soft};color:${metric.color}`,
        iconText: metric.name.slice(0, 1),
        isGlucose: metric.key === 'glucose',
        isBp: metric.key === 'bp',
        isLipid: metric.key === 'lipid',
        isUric: metric.key === 'uric',
        empty: true
      };
    }
    const status = latest.status || { key: 'ok', label: '达标' };
    const card = {
      key: metric.key,
      name: metric.name,
      unit: metric.unit,
      color: metric.color,
      soft: metric.soft,
      softStyle: `background:${metric.soft};color:${metric.color}`,
      iconText: metric.name.slice(0, 1),
      isGlucose: metric.key === 'glucose',
      isBp: metric.key === 'bp',
      isLipid: metric.key === 'lipid',
      isUric: metric.key === 'uric',
      latest,
      empty: false,
      statusClass: statusClass(status),
      statusStyle: statusStyle(status),
      statusColorValue: this.statusColor(status.key),
      statusLabel: neutralStatusLabel(status),
      dateText: dayLabel(latest.measuredAt),
      timeText: fmtTime(latest.measuredAt),
      mdText: fmtMD(latest.measuredAt),
      headTimeText: metric.key === 'lipid' ? `${fmtMD(latest.measuredAt)} 化验` : `${dayLabel(latest.measuredAt)} ${fmtTime(latest.measuredAt)}`,
      headLeftText: metric.key === 'lipid' ? `${fmtMD(latest.measuredAt)} 化验` : (periodNames[latest.period] || latest.periodName || ''),
      periodText: periodNames[latest.period] || latest.periodName || ''
    };
    if (metric.key === 'glucose') {
      card.valueText = latest.displayValue || latest.valueMmol;
      card.unitText = me.unit === 'mgdl' ? 'mg/dL' : 'mmol/L';
      card.targetText = `目标 ${me.target ? me.target.fastingLow : 4.4}-${me.target ? me.target.postMealHigh : 10}`;
      card.bandLeft = '10.5%';
      card.bandWidth = '33.9%';
      card.dotLeft = `${Math.max(0, Math.min(100, ((Number(latest.valueMmol) - 2) / 18) * 100))}%`;
    } else if (metric.key === 'bp') {
      card.valueText = `${latest.sbp}/${latest.dbp}`;
      card.extraText = latest.pulse ? `♥ ${latest.pulse}` : '';
      card.subText = '家庭自测参考 <135/85';
    } else if (metric.key === 'lipid') {
      card.valueText = '最近化验';
      card.lipid = [
        { label: 'TC', value: latest.tc || '—', style: latest.itemStatus && latest.itemStatus.tc ? `color:${this.statusColor(latest.itemStatus.tc)}` : '' },
        { label: 'TG', value: latest.tg || '—', style: latest.itemStatus && latest.itemStatus.tg ? `color:${this.statusColor(latest.itemStatus.tg)}` : '' },
        { label: 'LDL-C', value: latest.ldl || '—', style: latest.itemStatus && latest.itemStatus.ldl ? `color:${this.statusColor(latest.itemStatus.ldl)}` : '' },
        { label: 'HDL-C', value: latest.hdl || '—', style: latest.itemStatus && latest.itemStatus.hdl ? `color:${this.statusColor(latest.itemStatus.hdl)}` : '' }
      ];
    } else {
      card.valueText = latest.value;
      card.subText = `参考上限 <${me.sex === 'female' ? 360 : 420}`;
    }
    return card;
  },

  statusColor(key) {
    return ({ ok: '#19A77E', hi: '#E8833A', lo: '#4A7DDB', dhigh: '#D6453D', dlow: '#D6453D' })[key] || '#7A8A85';
  },

  goStats(event) {
    const metric = event.currentTarget.dataset.metric || 'glucose';
    wx.setStorageSync('tangji_stat_metric', metric);
    wx.redirectTo({ url: '/pages/stats/index' });
  },

  goRecord(event) {
    const metric = event.currentTarget.dataset.metric || 'glucose';
    wx.setStorageSync('tangji_record_metric', metric);
    wx.redirectTo({ url: '/pages/record/index' });
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
    if (tab === 'home') return;
    wx.redirectTo({ url: urlMap[tab] });
  }
});
