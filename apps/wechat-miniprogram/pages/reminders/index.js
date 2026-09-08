const { getToken } = require('../../utils/api');
const { captureDataLease, isDataLeaseCurrent } = require('../../utils/data-cache');
const { doLogin, ensureLogin, friendlyErrorMessage, handleRequestError } = require('../../utils/page');
const { glucosePeriods, periodNames } = require('../../utils/metrics');
const {
  hasPlanTime,
  hasTemplates,
  loadReminders,
  metricName,
  planFor,
  reminderErrorMessage,
  reportSubscriptions,
  requestSubscribe,
  savePlan,
  templateMetrics
} = require('../../utils/reminders');

// Same option list as the record page's glucose period chips, with the full
// labels because a native picker has room for them.
const PERIOD_LABELS = glucosePeriods.map((key) => periodNames[key]);
const MEDICATION_SUB_TEXT = '按常用药里的时间提醒';

Page({
  data: {
    authed: true,
    loading: false,
    available: true,
    busyMetric: '',
    periodLabels: PERIOD_LABELS,
    cards: [],
    navStyle: ''
  },

  onLoad() {
    this._state = null;
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
    const requestToken = getToken();
    const lease = captureDataLease(requestToken, []);
    try {
      this.setData({ loading: true });
      const state = await loadReminders();
      if (!isDataLeaseCurrent(lease, getToken())) return;
      this.applyState(state);
    } catch (error) {
      if (!isDataLeaseCurrent(lease, getToken())) return;
      if (handleRequestError(this, error, requestToken)) return;
      wx.showToast({ title: friendlyErrorMessage(error, '加载失败'), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyState(state) {
    this._state = state;
    this.setData({
      authed: true,
      available: hasTemplates(state.templates),
      cards: templateMetrics(state.templates).map((metric) => this.cardFor(metric, planFor(state, metric)))
    });
  },

  cardFor(metric, plan) {
    const isGlucose = metric === 'glucose';
    const hasTime = hasPlanTime(metric);
    const periodIndex = isGlucose ? Math.max(0, glucosePeriods.indexOf(plan.period)) : -1;
    return {
      metric,
      name: metricName(metric),
      isGlucose,
      // Medication reminders follow the times on each medication, so the
      // card is just a switch (spec §3.4).
      hasTime,
      subText: hasTime ? '' : MEDICATION_SUB_TEXT,
      enabled: plan.enabled,
      switchClass: plan.enabled ? 'on' : '',
      statusText: plan.enabled ? (hasTime ? `已开启 · 每天 ${plan.time}` : '已开启') : '未开启',
      time: plan.time,
      period: isGlucose ? glucosePeriods[periodIndex] : null,
      periodText: isGlucose ? PERIOD_LABELS[periodIndex] : '',
      periodIndex
    };
  },

  cardOf(event) {
    const metric = event && event.currentTarget && event.currentTarget.dataset.metric;
    return this.data.cards.find((card) => card.metric === metric) || null;
  },

  updateCard(metric, plan) {
    this.setData({
      cards: this.data.cards.map((card) => (card.metric === metric ? this.cardFor(metric, plan) : card))
    });
  },

  toggleReminder(event) {
    const card = this.cardOf(event);
    if (!card || this.data.busyMetric || !this._state) return;
    if (card.enabled) {
      this.submit(card.metric, { enabled: false, time: card.time, period: card.period });
      return;
    }
    // Synchronous, inside the tap: WeChat only opens the dialog from a gesture.
    const subscribing = requestSubscribe(this._state.templates, [card.metric]);
    this.submit(card.metric, { enabled: true, time: card.time, period: card.period }, subscribing);
  },

  onTimeChange(event) {
    const card = this.cardOf(event);
    const time = event.detail && event.detail.value;
    if (!card || !time || time === card.time) return;
    this.submit(card.metric, { enabled: card.enabled, time, period: card.period });
  },

  onPeriodChange(event) {
    const card = this.cardOf(event);
    if (!card || !card.isGlucose) return;
    const period = glucosePeriods[Number(event.detail && event.detail.value)] || glucosePeriods[0];
    if (period === card.period) return;
    this.submit(card.metric, { enabled: card.enabled, time: card.time, period });
  },

  async submit(metric, body, subscribing) {
    if (this.data.busyMetric) return;
    const requestToken = getToken();
    const lease = captureDataLease(requestToken, []);
    this.setData({ busyMetric: metric });
    try {
      const plan = await savePlan(metric, body);
      if (subscribing) {
        const result = await subscribing;
        await reportSubscriptions(result && result.accepted);
      }
      if (!isDataLeaseCurrent(lease, getToken())) return;
      this.updateCard(metric, plan);
      wx.showToast({ title: this.successMessage(metric, plan, subscribing ? 'enable' : (body.enabled ? 'update' : 'disable')), icon: 'none' });
    } catch (error) {
      if (!isDataLeaseCurrent(lease, getToken())) return;
      if (handleRequestError(this, error, requestToken)) return;
      wx.showToast({ title: reminderErrorMessage(error, friendlyErrorMessage(error, '设置失败，请稍后重试')), icon: 'none' });
    } finally {
      this.setData({ busyMetric: '' });
    }
  },

  successMessage(metric, plan, mode) {
    const name = metricName(metric);
    if (mode === 'disable' || !plan.enabled) return mode === 'disable' ? `已关闭${name}提醒` : '已保存，打开开关后生效';
    if (!hasPlanTime(metric)) return `已开启，${MEDICATION_SUB_TEXT}您`;
    if (mode === 'enable') return `已开启，每天 ${plan.time} 提醒您测${name}`;
    return `已保存，每天 ${plan.time} 提醒您测${name}`;
  },

  back() {
    wx.navigateBack({ delta: 1 });
  }
});
