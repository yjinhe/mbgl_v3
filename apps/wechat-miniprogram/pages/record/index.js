const { request } = require('../../utils/api');
const { doLogin, loadAppData } = require('../../utils/page');
const { toDateInput, toIsoFromInputs, toTimeInput } = require('../../utils/format');
const {
  bpPeriods,
  bpStatus,
  bpTags,
  glucosePeriods,
  glucoseStatus,
  glucoseTags,
  inferBpPeriod,
  inferGlucosePeriod,
  lipidItemStatus,
  lipidItems,
  metrics,
  periodNames,
  statusClass,
  statusColor,
  uricStatus
} = require('../../utils/metrics');

Page({
  data: {
    authed: true,
    loading: false,
    saving: false,
    me: null,
    metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === 'glucose', className: item.key === 'glucose' ? 'on' : '' })),
    metric: 'glucose',
    dateValue: toDateInput(),
    timeValue: toTimeInput(),
    glucosePeriods: glucosePeriods.map((key) => ({ key, name: periodNames[key], active: key === inferGlucosePeriod(), className: key === inferGlucosePeriod() ? 'on' : '' })),
    bpPeriods: bpPeriods.map((key) => ({ key, name: periodNames[key], active: key === inferBpPeriod(), className: key === inferBpPeriod() ? 'on' : '' })),
    glucoseTags: glucoseTags.map((name) => ({ name, active: false, className: '' })),
    bpTags: bpTags.map((name) => ({ name, active: false, className: '' })),
    lipidItems: lipidItems.map((item) => Object.assign({}, item, { dotStyle: '', value: '' })),
    period: inferGlucosePeriod(),
    tags: [],
    value: '',
    sbp: '',
    dbp: '',
    pulse: '',
    bpFocus: 'sbp',
    sbpAct: 'act',
    dbpAct: '',
    pulseAct: '',
    sbpCursor: true,
    dbpCursor: false,
    pulseCursor: false,
    lipid: { tc: '', tg: '', ldl: '', hdl: '', fasting: true },
    fasting: true,
    fastingClass: 'on',
    note: '',
    live: { text: '输入血糖值', className: 'mut', style: 'color:#7A8A85' },
    isGlucose: true,
    isBp: false,
    isLipid: false,
    isUric: false,
    unitText: 'mmol/L',
    dotKeyText: '·',
    lipidFastingClass: 'on',
    toast: '',
    toastOn: '',
    sheetOn: 'on',
    maskOn: 'on',
    navStyle: ''
  },

  onLoad() {
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  async onShow() {
    const selected = wx.getStorageSync('tangji_record_metric') || this.data.metric;
    wx.removeStorageSync('tangji_record_metric');
    this.setMetricValue(selected);
    const data = await loadAppData(this);
    if (!data) {
      wx.reLaunch({ url: '/pages/home/index' });
      return;
    }
    this.setData({
      unitText: this.unitTextFor(this.data.metric)
    });
    this.updateLive();
  },

  async login() {
    await doLogin(this, () => loadAppData(this));
  },

  setMetric(event) {
    this.setMetricValue(event.currentTarget.dataset.metric);
  },

  setMetricValue(metric) {
    const now = new Date();
    this.setData({
      metric,
      metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === metric, className: item.key === metric ? 'on' : '' })),
      isGlucose: metric === 'glucose',
      isBp: metric === 'bp',
      isLipid: metric === 'lipid',
      isUric: metric === 'uric',
      unitText: this.unitTextFor(metric),
      dateValue: toDateInput(now),
      timeValue: toTimeInput(now),
      period: metric === 'bp' ? inferBpPeriod(now) : inferGlucosePeriod(now),
      glucosePeriods: glucosePeriods.map((key) => ({ key, name: periodNames[key], active: key === inferGlucosePeriod(now), className: key === inferGlucosePeriod(now) ? 'on' : '' })),
      bpPeriods: bpPeriods.map((key) => ({ key, name: periodNames[key], active: key === inferBpPeriod(now), className: key === inferBpPeriod(now) ? 'on' : '' })),
      glucoseTags: glucoseTags.map((name) => ({ name, active: false, className: '' })),
      bpTags: bpTags.map((name) => ({ name, active: false, className: '' })),
      lipidItems: lipidItems.map((item) => Object.assign({}, item, { dotStyle: '', value: '' })),
      tags: [],
      value: '',
      sbp: '',
      dbp: '',
      pulse: '',
      bpFocus: 'sbp',
      sbpAct: 'act',
      dbpAct: '',
      pulseAct: '',
      sbpCursor: true,
      dbpCursor: false,
      pulseCursor: false,
      lipid: { tc: '', tg: '', ldl: '', hdl: '', fasting: true },
      fasting: true,
      fastingClass: 'on',
      lipidFastingClass: 'on',
      dotKeyText: metric === 'bp' ? '下一项' : '·',
      note: ''
    }, () => this.updateLive());
  },

  unitTextFor(metric) {
    if (metric === 'glucose') return this.data.me && this.data.me.unit === 'mgdl' ? 'mg/dL' : 'mmol/L';
    if (metric === 'uric') return 'μmol/L';
    return 'mmol/L';
  },

  onInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [key]: event.detail.value }, () => this.updateLive());
  },

  pressKey(event) {
    const key = event.currentTarget.dataset.key;
    const metric = this.data.metric;
    if (metric === 'bp') {
      this.pressBpKey(key);
      return;
    }
    if (key === 'del') {
      this.setData({ value: this.data.value.slice(0, -1) }, () => this.updateLive());
      return;
    }
    if (key === '.') {
      if (metric === 'glucose' && this.data.unitText !== 'mg/dL' && !this.data.value.includes('.')) {
        this.setData({ value: (this.data.value || '0') + '.' }, () => this.updateLive());
      }
      return;
    }
    const next = this.nextScalarValue(this.data.value, key, metric);
    this.setData({ value: next }, () => this.updateLive());
  },

  nextScalarValue(current, key, metric) {
    if (metric === 'uric') return `${current}${key}`.slice(0, 4);
    if (metric === 'glucose' && this.data.unitText === 'mg/dL') return `${current}${key}`.slice(0, 3);
    const text = `${current}${key}`;
    const parts = text.split('.');
    if (parts[0].length > 2) return current;
    if (parts[1] && parts[1].length > 1) return current;
    return text;
  },

  pressBpKey(key) {
    const order = ['sbp', 'dbp', 'pulse'];
    const focus = this.data.bpFocus;
    if (key === '.') {
      const nextFocus = order[Math.min(2, order.indexOf(focus) + 1)];
      this.setBpFocus(nextFocus);
      return;
    }
    if (key === 'del') {
      const value = this.data[focus];
      if (value) {
        this.setData({ [focus]: value.slice(0, -1) }, () => this.updateLive());
      } else {
        const nextFocus = order[Math.max(0, order.indexOf(focus) - 1)];
        this.setBpFocus(nextFocus);
      }
      return;
    }
    const next = `${this.data[focus]}${key}`.slice(0, 3);
    const updates = { [focus]: next };
    if (next.length >= 3) {
      const nextFocus = order[Math.min(2, order.indexOf(focus) + 1)];
      Object.assign(updates, this.bpFocusPatch(nextFocus));
    }
    this.setData(updates, () => this.updateLive());
  },

  selectBpField(event) {
    this.setBpFocus(event.currentTarget.dataset.field);
  },

  setBpFocus(field) {
    this.setData(this.bpFocusPatch(field));
  },

  bpFocusPatch(field) {
    return {
      bpFocus: field,
      sbpAct: field === 'sbp' ? 'act' : '',
      dbpAct: field === 'dbp' ? 'act' : '',
      pulseAct: field === 'pulse' ? 'act' : '',
      sbpCursor: field === 'sbp',
      dbpCursor: field === 'dbp',
      pulseCursor: field === 'pulse'
    };
  },

  onLipidInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`lipid.${key}`]: event.detail.value }, () => {
      this.updateLipidItems();
      this.updateLive();
    });
  },

  setPeriod(event) {
    const period = event.currentTarget.dataset.period;
    this.setData({
      period,
      glucosePeriods: glucosePeriods.map((key) => ({ key, name: periodNames[key], active: key === period, className: key === period ? 'on' : '' })),
      bpPeriods: bpPeriods.map((key) => ({ key, name: periodNames[key], active: key === period, className: key === period ? 'on' : '' }))
    }, () => this.updateLive());
  },

  toggleTag(event) {
    const tag = event.currentTarget.dataset.tag;
    const tags = this.data.tags.includes(tag)
      ? this.data.tags.filter((item) => item !== tag)
      : this.data.tags.concat(tag);
    this.setData({
      tags,
      glucoseTags: glucoseTags.map((name) => ({ name, active: tags.includes(name), className: tags.includes(name) ? 'on' : '' })),
      bpTags: bpTags.map((name) => ({ name, active: tags.includes(name), className: tags.includes(name) ? 'on' : '' }))
    });
  },

  toggleFasting() {
    const fasting = !this.data.fasting;
    this.setData({ fasting, fastingClass: fasting ? 'on' : '' });
  },

  toggleLipidFasting() {
    const fasting = !this.data.lipid.fasting;
    this.setData({ 'lipid.fasting': fasting, lipidFastingClass: fasting ? 'on' : '' });
  },

  updateLipidItems() {
    const lipid = this.data.lipid;
    this.setData({
      lipidItems: lipidItems.map((item) => {
        if (lipid[item.key] === '') return Object.assign({}, item, { dotStyle: '', value: '' });
        const status = lipidItemStatus(item.key, Number(lipid[item.key]));
        return Object.assign({}, item, { dotStyle: `background:${statusColor[status.key]}`, value: lipid[item.key] });
      })
    });
  },

  updateLive() {
    const { metric, value, period, me, sbp, dbp, lipid } = this.data;
    let status = null;
    let text = '';
    if (metric === 'glucose') {
      if (!value) text = '输入血糖值';
      else {
        status = glucoseStatus(Number(value), period, me && me.target);
        text = status.label;
      }
    } else if (metric === 'bp') {
      if (!sbp || !dbp) text = sbp || dbp ? '继续输入血压值' : '输入血压值';
      else {
        status = bpStatus(Number(sbp), Number(dbp));
        text = status.label;
      }
    } else if (metric === 'lipid') {
      const hasAny = lipidItems.some((item) => lipid[item.key] !== '');
      text = hasAny ? '整体评估以已填项中最严重一档为准' : '至少填写一项即可保存';
    } else {
      if (!value) text = '输入尿酸值';
      else {
        status = uricStatus(Number(value), me && me.sex);
        text = status.label;
      }
    }
    this.setData({
      live: {
        text,
        className: status ? statusClass(status) : 'mut',
        style: `color:${status ? statusColor[status.key] : '#7A8A85'}`
      }
    });
  },

  async save() {
    if (this.data.saving) return;
    try {
      this.setData({ saving: true });
      const metric = this.data.metric;
      const measuredAt = toIsoFromInputs(this.data.dateValue, this.data.timeValue);
      let data = { measuredAt, note: this.data.note };
      if (metric === 'glucose') {
        if (!this.data.value) throw new Error('请输入血糖值');
        data = Object.assign(data, {
          value: Number(this.data.value),
          unit: this.data.me && this.data.me.unit ? this.data.me.unit : 'mmol',
          period: this.data.period,
          tags: this.data.tags
        });
      } else if (metric === 'bp') {
        if (!this.data.sbp || !this.data.dbp) throw new Error('请输入血压值');
        if (Number(this.data.sbp) <= Number(this.data.dbp)) throw new Error('收缩压应高于舒张压，请检查输入');
        data = Object.assign(data, {
          sbp: Number(this.data.sbp),
          dbp: Number(this.data.dbp),
          pulse: this.data.pulse ? Number(this.data.pulse) : undefined,
          period: this.data.period,
          tags: this.data.tags
        });
      } else if (metric === 'lipid') {
        const filled = {};
        lipidItems.forEach((item) => {
          if (this.data.lipid[item.key] !== '') filled[item.key] = Number(this.data.lipid[item.key]);
        });
        if (!Object.keys(filled).length) throw new Error('至少填写一项血脂指标');
        data = Object.assign(data, filled, { fasting: this.data.lipid.fasting });
      } else {
        if (!this.data.value) throw new Error('请输入尿酸值');
        data = Object.assign(data, { value: Number(this.data.value), fasting: this.data.fasting });
      }
      const result = await request(`/api/app/records/${metric}`, { method: 'POST', data });
      this.showToast(metric === 'glucose' ? `已记录 ${result.record.displayValue || this.data.value}` : '已记录');
      this.setMetricValue(metric);
      if (result.safetyAlert) setTimeout(() => this.showSafety(), 340);
    } catch (error) {
      this.showToast(error.message || '保存失败');
    } finally {
      this.setData({ saving: false });
    }
  },

  showSafety() {
    wx.showModal({
      title: '数值提醒',
      content: '本次数值超出参考范围，仅供个人记录。如有不适，请咨询专业医疗机构。',
      showCancel: false
    });
  },

  showToast(message) {
    this.setData({ toast: message, toastOn: 'on' });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setData({ toastOn: '' }), 2100);
  },

  closeSheet() {
    wx.redirectTo({ url: '/pages/home/index' });
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
    if (tab === 'record') return;
    wx.redirectTo({ url: urlMap[tab] });
  }
});
