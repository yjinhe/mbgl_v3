const { getToken, request } = require('../../utils/api');
const {
  captureDataLease,
  isDataLeaseCurrent,
  isPageFresh,
  markPageFresh,
  markRecordsChanged
} = require('../../utils/data-cache');
const { loadMe, promptLoginForAction } = require('../../utils/page');
const { demoMe } = require('../../utils/demo');
const { toDateInput, toIsoFromInputs, toTimeInput } = require('../../utils/format');
const {
  consumeRecordMetric,
  consumeRecordReturnPath,
  setRecordReturnPath,
  syncTabBar
} = require('../../utils/tabbar');
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

const RECORD_CACHE_DOMAINS = ['profile'];
const GLUCOSE_RANGES = {
  mmol: { min: 1.1, max: 33.3, label: '1.1–33.3 mmol/L' },
  mgdl: { min: 20, max: 600, label: '20–600 mg/dL' }
};
const BP_RANGES = {
  sbp: { min: 50, max: 300 },
  dbp: { min: 30, max: 200 },
  pulse: { min: 30, max: 220 }
};
const LIPID_RANGE = { min: 0.1, max: 30 };
const URIC_RANGE = { min: 50, max: 1500 };

Page({
  data: {
    authed: false,
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
    lipidItems: lipidItems.map((item) => Object.assign({}, item, {
      dotStyle: '',
      statusStyle: 'color:#7A8A85',
      statusText: '待填写',
      value: ''
    })),
    period: inferGlucosePeriod(),
    recommendedPeriod: inferGlucosePeriod(),
    periodIsRecommended: true,
    periodRecommended: true,
    periodWasManuallySelected: false,
    periodHintText: '已按测量时间推荐',
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
    decimalKeyDisabled: false,
    decimalKeyHint: '可输入一位小数',
    inputValid: true,
    inputError: '',
    measurementTimeValid: true,
    measurementTimeError: '',
    maxDateValue: toDateInput(),
    todayValue: toDateInput(),
    dateMax: toDateInput(),
    lipidFastingClass: 'on',
    toast: '',
    toastOn: '',
    sheetOn: 'on',
    maskOn: 'on',
    navStyle: ''
  },

  onLoad() {
    this._metricDrafts = Object.create(null);
    this.setData({ navStyle: getApp().globalData.navStyle });
  },

  async onShow() {
    syncTabBar(this);
    const selected = consumeRecordMetric();
    if (!this._formInitialized || selected) {
      this._formInitialized = true;
      this.setMetricValue(selected || this.data.metric);
    } else if (!this.hasDraft()) {
      this.refreshEmptyDraftTime();
    }
    if (this.isProfileFresh()) return;

    const lease = captureDataLease(getToken(), RECORD_CACHE_DOMAINS);
    const me = await loadMe(this, { apply: false });
    if (me === false || !isDataLeaseCurrent(lease, getToken())) return;
    const nextMe = me || demoMe;
    const nextUnitText = this.unitTextFor(this.data.metric, nextMe);
    const unitChangedWithValue = this.data.metric === 'glucose'
      && Boolean(this.data.value)
      && nextUnitText !== this.data.unitText;
    const decimalPatch = this.decimalKeyPatch(this.data.metric, nextUnitText);
    this.setData(Object.assign({
      authed: Boolean(me),
      me: nextMe,
      loading: false,
      unitText: nextUnitText,
      value: unitChangedWithValue ? '' : this.data.value
    }, decimalPatch), () => this.updateLive());
    if (unitChangedWithValue) this.showToast('血糖单位已更新，请重新输入');
    this.markProfileFresh();
  },

  setMetric(event) {
    this.setMetricValue(event.currentTarget.dataset.metric);
  },

  setMetricValue(metric, options = {}) {
    if (!this._metricDrafts) this._metricDrafts = Object.create(null);
    const metricExists = metrics.some((item) => item.key === metric);
    if (!metricExists) metric = 'glucose';
    const previousMetric = this._activeMetric;
    if (previousMetric && previousMetric !== metric && !options.reset) {
      this.captureMetricDraft(previousMetric);
    }
    if (options.reset) delete this._metricDrafts[metric];

    const draft = this._metricDrafts[metric] || this.emptyMetricDraft(metric);
    const unitText = this.unitTextFor(metric);
    const unitChangedWithValue = metric === 'glucose'
      && Boolean(draft.value)
      && Boolean(draft.glucoseUnit)
      && draft.glucoseUnit !== unitText;
    if (unitChangedWithValue) draft.value = '';
    draft.glucoseUnit = unitText;
    const recommendedPeriod = draft.recommendedPeriod || this.inferPeriod(metric, this.measurementDate(draft.dateValue, draft.timeValue));
    const period = draft.period || recommendedPeriod;
    const periodIsRecommended = period === recommendedPeriod;
    this._activeMetric = metric;

    this.setData(Object.assign({
      metric,
      metrics: metrics.map((item) => Object.assign({}, item, { active: item.key === metric, className: item.key === metric ? 'on' : '' })),
      isGlucose: metric === 'glucose',
      isBp: metric === 'bp',
      isLipid: metric === 'lipid',
      isUric: metric === 'uric',
      unitText,
      dateValue: draft.dateValue,
      timeValue: draft.timeValue,
      period,
      recommendedPeriod,
      periodIsRecommended,
      periodRecommended: periodIsRecommended,
      periodWasManuallySelected: Boolean(draft.periodWasManuallySelected),
      periodHintText: this.periodHintText(period, recommendedPeriod, Boolean(draft.periodWasManuallySelected)),
      glucosePeriods: this.periodOptions(glucosePeriods, period),
      bpPeriods: this.periodOptions(bpPeriods, period),
      glucoseTags: glucoseTags.map((name) => ({ name, active: draft.tags.includes(name), className: draft.tags.includes(name) ? 'on' : '' })),
      bpTags: bpTags.map((name) => ({ name, active: draft.tags.includes(name), className: draft.tags.includes(name) ? 'on' : '' })),
      lipidItems: this.lipidItemsFor(draft.lipid),
      tags: draft.tags.slice(),
      value: unitChangedWithValue ? '' : draft.value,
      sbp: draft.sbp,
      dbp: draft.dbp,
      pulse: draft.pulse,
      lipid: Object.assign({}, draft.lipid),
      fasting: draft.fasting,
      fastingClass: draft.fasting ? 'on' : '',
      lipidFastingClass: draft.lipid.fasting ? 'on' : '',
      note: draft.note,
      measurementTimeValid: this.isMeasurementTimeValid(draft.dateValue, draft.timeValue),
      measurementTimeError: this.measurementTimeError(draft.dateValue, draft.timeValue),
      maxDateValue: toDateInput(),
      todayValue: toDateInput(),
      dateMax: toDateInput()
    }, this.bpFocusPatch(draft.bpFocus), this.decimalKeyPatch(metric, unitText)), () => this.updateLive());
    if (unitChangedWithValue) this.showToast('血糖单位已更新，请重新输入');
  },

  emptyMetricDraft(metric, now = new Date()) {
    const period = this.inferPeriod(metric, now);
    return {
      dateValue: toDateInput(now),
      timeValue: toTimeInput(now),
      period,
      recommendedPeriod: period,
      periodWasManuallySelected: false,
      tags: [],
      value: '',
      sbp: '',
      dbp: '',
      pulse: '',
      bpFocus: 'sbp',
      lipid: { tc: '', tg: '', ldl: '', hdl: '', fasting: true },
      fasting: true,
      note: '',
      glucoseUnit: this.unitTextFor(metric)
    };
  },

  captureMetricDraft(metric) {
    if (!this._metricDrafts) this._metricDrafts = Object.create(null);
    this._metricDrafts[metric] = {
      dateValue: this.data.dateValue,
      timeValue: this.data.timeValue,
      period: this.data.period,
      recommendedPeriod: this.data.recommendedPeriod,
      periodWasManuallySelected: this.data.periodWasManuallySelected,
      tags: this.data.tags.slice(),
      value: this.data.value,
      sbp: this.data.sbp,
      dbp: this.data.dbp,
      pulse: this.data.pulse,
      bpFocus: this.data.bpFocus,
      lipid: Object.assign({}, this.data.lipid),
      fasting: this.data.fasting,
      note: this.data.note,
      glucoseUnit: metric === 'glucose' ? this.data.unitText : undefined
    };
  },

  inferPeriod(metric, date) {
    const measuredAt = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return metric === 'bp' ? inferBpPeriod(measuredAt) : inferGlucosePeriod(measuredAt);
  },

  periodOptions(options, period) {
    return options.map((key) => ({
      key,
      name: periodNames[key],
      active: key === period,
      className: key === period ? 'on' : ''
    }));
  },

  periodHintText(period, recommendedPeriod, wasManuallySelected) {
    if (!wasManuallySelected) return '已按测量时间推荐';
    if (period === recommendedPeriod) return '已手动选择 · 与推荐一致';
    return `已手动选择 · 推荐${periodNames[recommendedPeriod] || ''}`;
  },

  decimalKeyPatch(metric, unitText) {
    if (metric === 'bp') {
      return { dotKeyText: '下一项', decimalKeyDisabled: false, decimalKeyHint: '切换输入项' };
    }
    if (metric === 'uric') {
      return { dotKeyText: '整数', decimalKeyDisabled: true, decimalKeyHint: '尿酸值使用整数' };
    }
    if (metric === 'glucose' && unitText === 'mg/dL') {
      return { dotKeyText: '整数', decimalKeyDisabled: true, decimalKeyHint: 'mg/dL 使用整数' };
    }
    return { dotKeyText: '·', decimalKeyDisabled: false, decimalKeyHint: '可输入一位小数' };
  },

  measurementDate(dateValue = this.data.dateValue, timeValue = this.data.timeValue) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeValue || ''));
    if (!dateMatch || !timeMatch) return null;
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
    const measuredAt = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (measuredAt.getFullYear() !== year
      || measuredAt.getMonth() !== month - 1
      || measuredAt.getDate() !== day
      || measuredAt.getHours() !== hour
      || measuredAt.getMinutes() !== minute) return null;
    return measuredAt;
  },

  measurementTimeError(dateValue = this.data.dateValue, timeValue = this.data.timeValue) {
    const measuredAt = this.measurementDate(dateValue, timeValue);
    if (!measuredAt) return '测量时间不正确';
    if (measuredAt.getTime() > Date.now()) return '测量时间不能晚于现在';
    return '';
  },

  isMeasurementTimeValid(dateValue = this.data.dateValue, timeValue = this.data.timeValue) {
    return !this.measurementTimeError(dateValue, timeValue);
  },

  syncMeasurementTime() {
    const measuredAt = this.measurementDate();
    const recommendedPeriod = this.inferPeriod(this.data.metric, measuredAt);
    const measurementTimeError = this.measurementTimeError();
    this.setData({
      period: recommendedPeriod,
      recommendedPeriod,
      periodIsRecommended: true,
      periodRecommended: true,
      periodWasManuallySelected: false,
      periodHintText: '已按测量时间推荐',
      glucosePeriods: this.periodOptions(glucosePeriods, recommendedPeriod),
      bpPeriods: this.periodOptions(bpPeriods, recommendedPeriod),
      measurementTimeValid: !measurementTimeError,
      measurementTimeError,
      maxDateValue: toDateInput(),
      todayValue: toDateInput(),
      dateMax: toDateInput()
    }, () => this.updateLive());
  },

  numericValidation(rawValue, options) {
    const raw = String(rawValue == null ? '' : rawValue).trim();
    const pattern = options.integer ? /^\d+$/ : /^(?:\d+(?:\.\d+)?|\.\d+)$/;
    if (!pattern.test(raw)) return { ok: false, message: options.formatMessage };
    const value = Number(raw);
    if (!Number.isFinite(value) || value < options.min || value > options.max) {
      return { ok: false, message: options.rangeMessage };
    }
    return { ok: true, value };
  },

  glucoseInputValidation(rawValue = this.data.value) {
    const unit = this.data.unitText === 'mg/dL' ? 'mgdl' : 'mmol';
    const range = GLUCOSE_RANGES[unit];
    return this.numericValidation(rawValue, {
      integer: unit === 'mgdl',
      min: range.min,
      max: range.max,
      formatMessage: unit === 'mgdl' ? 'mg/dL 请输入整数' : '请输入完整的血糖值',
      rangeMessage: `请输入有效范围内的数值（${range.label}）`
    });
  },

  bpInputValidation() {
    const sbp = this.numericValidation(this.data.sbp, {
      integer: true,
      min: BP_RANGES.sbp.min,
      max: BP_RANGES.sbp.max,
      formatMessage: '请输入完整的收缩压',
      rangeMessage: '收缩压有效范围为 50–300 mmHg'
    });
    if (!sbp.ok) return sbp;
    const dbp = this.numericValidation(this.data.dbp, {
      integer: true,
      min: BP_RANGES.dbp.min,
      max: BP_RANGES.dbp.max,
      formatMessage: '请输入完整的舒张压',
      rangeMessage: '舒张压有效范围为 30–200 mmHg'
    });
    if (!dbp.ok) return dbp;
    if (sbp.value <= dbp.value) return { ok: false, message: '收缩压应高于舒张压，请检查输入' };
    let pulse;
    if (this.data.pulse !== '') {
      pulse = this.numericValidation(this.data.pulse, {
        integer: true,
        min: BP_RANGES.pulse.min,
        max: BP_RANGES.pulse.max,
        formatMessage: '请输入完整的脉搏值',
        rangeMessage: '脉搏有效范围为 30–220 次/分'
      });
      if (!pulse.ok) return pulse;
    }
    return { ok: true, sbp: sbp.value, dbp: dbp.value, pulse: pulse && pulse.value };
  },

  lipidValueValidation(rawValue, name) {
    return this.numericValidation(rawValue, {
      integer: false,
      min: LIPID_RANGE.min,
      max: LIPID_RANGE.max,
      formatMessage: `请输入完整的${name}`,
      rangeMessage: `${name}有效范围为 0.1–30 mmol/L`
    });
  },

  uricInputValidation(rawValue = this.data.value) {
    return this.numericValidation(rawValue, {
      integer: true,
      min: URIC_RANGE.min,
      max: URIC_RANGE.max,
      formatMessage: '尿酸值请输入整数',
      rangeMessage: '请输入有效范围内的数值（50–1500 μmol/L）'
    });
  },

  lipidInputValidation() {
    const values = {};
    for (const item of lipidItems) {
      const rawValue = this.data.lipid[item.key];
      if (rawValue === '') continue;
      const validation = this.lipidValueValidation(rawValue, item.name);
      if (!validation.ok) return validation;
      values[item.key] = validation.value;
    }
    if (!Object.keys(values).length) return { ok: false, message: '至少填写一项血脂指标' };
    return { ok: true, values };
  },

  lipidItemsFor(lipid) {
    return lipidItems.map((item) => {
      const rawValue = lipid[item.key];
      if (rawValue === '') {
        return Object.assign({}, item, { dotStyle: '', statusStyle: 'color:#7A8A85', statusText: '待填写', value: '' });
      }
      const validation = this.lipidValueValidation(rawValue, item.name);
      if (!validation.ok) {
        return Object.assign({}, item, { dotStyle: '', statusStyle: 'color:#D6453D', statusText: '范围有误', value: rawValue });
      }
      const status = lipidItemStatus(item.key, validation.value);
      return Object.assign({}, item, {
        dotStyle: `background:${statusColor[status.key]}`,
        statusStyle: `color:${statusColor[status.key]}`,
        statusText: status.label,
        value: rawValue
      });
    });
  },

  unitTextFor(metric, me = this.data.me) {
    if (metric === 'glucose') return me && me.unit === 'mgdl' ? 'mg/dL' : 'mmol/L';
    if (metric === 'uric') return 'μmol/L';
    return 'mmol/L';
  },

  hasDraft() {
    if (this.data.note || this.data.tags.length) return true;
    if (this.data.metric === 'bp') return Boolean(this.data.sbp || this.data.dbp || this.data.pulse);
    if (this.data.metric === 'lipid') {
      return lipidItems.some((item) => this.data.lipid[item.key] !== '');
    }
    return Boolean(this.data.value);
  },

  refreshEmptyDraftTime() {
    const now = new Date();
    const period = this.inferPeriod(this.data.metric, now);
    this.setData({
      dateValue: toDateInput(now),
      timeValue: toTimeInput(now),
      period,
      recommendedPeriod: period,
      periodIsRecommended: true,
      periodRecommended: true,
      periodWasManuallySelected: false,
      periodHintText: '已按测量时间推荐',
      glucosePeriods: this.periodOptions(glucosePeriods, period),
      bpPeriods: this.periodOptions(bpPeriods, period),
      measurementTimeValid: true,
      measurementTimeError: '',
      maxDateValue: toDateInput(now),
      todayValue: toDateInput(now),
      dateMax: toDateInput(now)
    }, () => this.updateLive());
  },

  onInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [key]: event.detail.value }, () => {
      if (key === 'dateValue' || key === 'timeValue') {
        this.syncMeasurementTime();
        return;
      }
      this.updateLive();
    });
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
      } else if (metric === 'uric') {
        this.showToast('尿酸值请输入整数');
      } else if (metric === 'glucose' && this.data.unitText === 'mg/dL') {
        this.showToast('mg/dL 单位请输入整数');
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
    const periodRecommended = period === this.data.recommendedPeriod;
    this.setData({
      period,
      periodIsRecommended: periodRecommended,
      periodRecommended,
      periodWasManuallySelected: true,
      periodHintText: this.periodHintText(period, this.data.recommendedPeriod, true),
      glucosePeriods: this.periodOptions(glucosePeriods, period),
      bpPeriods: this.periodOptions(bpPeriods, period)
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
    this.setData({ lipidItems: this.lipidItemsFor(this.data.lipid) });
  },

  updateLive() {
    const { metric, value, period, me, sbp, dbp, lipid } = this.data;
    let status = null;
    let text = '';
    let inputError = '';
    let inputValid = true;
    if (metric === 'glucose') {
      if (!value) text = '输入血糖值';
      else {
        const validation = this.glucoseInputValidation(value);
        if (!validation.ok) {
          text = validation.message;
          inputError = validation.message;
          inputValid = false;
        } else {
          const valueMmol = this.data.unitText === 'mg/dL' ? validation.value / 18 : validation.value;
          status = glucoseStatus(valueMmol, period, me && me.target);
          text = status.label;
        }
      }
    } else if (metric === 'bp') {
      if (!sbp || !dbp) text = sbp || dbp ? '继续输入血压值' : '输入血压值';
      else {
        const validation = this.bpInputValidation();
        if (!validation.ok) {
          text = validation.message;
          inputError = validation.message;
          inputValid = false;
        } else {
          status = bpStatus(validation.sbp, validation.dbp);
          text = status.label;
        }
      }
    } else if (metric === 'lipid') {
      const hasAny = lipidItems.some((item) => lipid[item.key] !== '');
      if (!hasAny) {
        text = '至少填写一项即可保存';
      } else {
        const validation = this.lipidInputValidation();
        if (!validation.ok) {
          text = validation.message;
          inputError = validation.message;
          inputValid = false;
        } else {
          text = '整体评估以已填项中最严重一档为准';
        }
      }
    } else {
      if (!value) text = '输入尿酸值';
      else {
        const validation = this.uricInputValidation(value);
        if (!validation.ok) {
          text = validation.message;
          inputError = validation.message;
          inputValid = false;
        } else {
          status = uricStatus(validation.value, me && me.sex);
          text = status.label;
        }
      }
    }
    this.setData({
      inputValid,
      inputError,
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
      const measurementError = this.measurementTimeError();
      if (measurementError) throw new Error(measurementError);
      const measuredAt = toIsoFromInputs(this.data.dateValue, this.data.timeValue);
      if (typeof this.data.note !== 'string' || this.data.note.length > 50) throw new Error('备注不能超过 50 个字符');
      let data = { measuredAt, note: this.data.note };
      if (metric === 'glucose') {
        if (!this.data.value) throw new Error('请输入血糖值');
        const validation = this.glucoseInputValidation();
        if (!validation.ok) throw new Error(validation.message);
        data = Object.assign(data, {
          value: validation.value,
          unit: this.data.unitText === 'mg/dL' ? 'mgdl' : 'mmol',
          period: this.data.period,
          tags: this.data.tags
        });
      } else if (metric === 'bp') {
        if (!this.data.sbp || !this.data.dbp) throw new Error('请输入血压值');
        const validation = this.bpInputValidation();
        if (!validation.ok) throw new Error(validation.message);
        data = Object.assign(data, {
          sbp: validation.sbp,
          dbp: validation.dbp,
          pulse: validation.pulse,
          period: this.data.period,
          tags: this.data.tags
        });
      } else if (metric === 'lipid') {
        const validation = this.lipidInputValidation();
        if (!validation.ok) throw new Error(validation.message);
        data = Object.assign(data, validation.values, { fasting: this.data.lipid.fasting });
      } else {
        if (!this.data.value) throw new Error('请输入尿酸值');
        const validation = this.uricInputValidation();
        if (!validation.ok) throw new Error(validation.message);
        data = Object.assign(data, { value: validation.value, fasting: this.data.fasting });
      }
      if (!this.data.authed) {
        promptLoginForAction({ metric, data });
        return;
      }
      const lease = captureDataLease(getToken(), []);
      const result = await request(`/api/app/records/${metric}`, { method: 'POST', data });
      if (!isDataLeaseCurrent(lease, getToken())) return;
      markRecordsChanged();
      const presentation = this.savedRecordPresentation(metric, data, result && result.record);
      this.setMetricValue(metric, { reset: true });
      this.showSaveSuccess(presentation, result && result.safetyAlert);
    } catch (error) {
      this.showToast(error.message || '保存失败');
    } finally {
      this.setData({ saving: false });
    }
  },

  savedRecordPresentation(metric, data, savedRecord) {
    const record = Object.assign({}, data, savedRecord || {});
    let summary = '健康记录';
    if (metric === 'glucose') {
      const value = record.displayValue != null ? record.displayValue : data.value;
      const unit = record.displayUnit || (data.unit === 'mgdl' ? 'mg/dL' : 'mmol/L');
      summary = `血糖 ${value} ${unit}`;
    } else if (metric === 'bp') {
      summary = `血压 ${data.sbp}/${data.dbp} mmHg`;
      if (data.pulse) summary += `，脉搏 ${data.pulse}`;
    } else if (metric === 'lipid') {
      const labels = { tc: 'TC', tg: 'TG', ldl: 'LDL-C', hdl: 'HDL-C' };
      const values = Object.keys(labels)
        .filter((key) => data[key] !== undefined)
        .map((key) => `${labels[key]} ${data[key]}`);
      summary = `血脂 ${values.join('、')}`;
    } else if (metric === 'uric') {
      summary = `尿酸 ${data.value} μmol/L`;
    }
    return {
      summary,
      timeText: `${this.data.dateValue} ${this.data.timeValue}`
    };
  },

  safetyNotice(safetyAlert) {
    if (!safetyAlert) return '';
    const status = safetyAlert === 'low' ? '明显偏低' : '明显偏高';
    return `\n\n本次数值${status}，请核对录入是否正确；如有不适，请及时咨询专业医疗机构。`;
  },

  showSaveSuccess(presentation, safetyAlert) {
    wx.showModal({
      title: safetyAlert ? '记录已保存，请留意' : '记录已保存',
      content: `${presentation.summary}\n记录时间：${presentation.timeText}${this.safetyNotice(safetyAlert)}`,
      cancelText: '再记一笔',
      confirmText: '完成返回',
      success: (result) => {
        if (result.confirm) this.closeSheet();
      },
      fail: () => this.showToast('记录已保存')
    });
  },

  showToast(message) {
    this.setData({ toast: message, toastOn: 'on' });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setData({ toastOn: '' }), 2100);
  },

  closeSheet() {
    const returnPath = consumeRecordReturnPath('/pages/home/index');
    wx.switchTab({
      url: returnPath,
      fail: () => setRecordReturnPath(returnPath)
    });
  },

  isProfileFresh() {
    return isPageFresh(this, 'record:profile', RECORD_CACHE_DOMAINS, getToken());
  },

  markProfileFresh() {
    markPageFresh(this, 'record:profile', RECORD_CACHE_DOMAINS, getToken());
  }
});
