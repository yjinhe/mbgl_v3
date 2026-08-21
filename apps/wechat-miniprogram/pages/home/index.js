const { clearPendingRecord, doLogin, getPendingRecord, loadAppData } = require('../../utils/page');
const { getToken, request } = require('../../utils/api');
const { prepareAvatar } = require('../../utils/avatar');
const {
  captureDataLease,
  isPageFresh,
  isDataLeaseCurrent,
  markPageFresh,
  markProfileChanged,
  markRecordsChanged
} = require('../../utils/data-cache');
const { demoMe, demoOverview } = require('../../utils/demo');
const { hasConsent } = require('../../utils/privacy');
const {
  clearRecordReturnPath,
  setRecordMetric,
  setRecordReturnPath,
  setStatMetric,
  syncTabBar
} = require('../../utils/tabbar');
const {
  fmtMD,
  fmtTime,
  dayLabel,
  greetingAt,
  localDateLine,
  toDateInput,
  toTimeInput
} = require('../../utils/format');
const { metrics, neutralStatusLabel, statusClass, statusStyle, periodNames } = require('../../utils/metrics');

const HOME_ICON_ROOT = '/assets/home-icons';
const HOME_CACHE_DOMAINS = ['records', 'profile'];

function metricIcon(metricKey) {
  if (metricKey !== 'bp' && metricKey !== 'uric') return '';
  return `${HOME_ICON_ROOT}/metric-${metricKey}.png`;
}

function overviewIcon(metricKey, statusKey) {
  if (!statusKey) return `${HOME_ICON_ROOT}/status-empty.png`;
  if (statusKey === 'ok') return `${HOME_ICON_ROOT}/status-check-${metricKey}.png`;
  if (statusKey === 'hi') return `${HOME_ICON_ROOT}/status-alert-hi.png`;
  if (statusKey === 'lo') return `${HOME_ICON_ROOT}/status-alert-lo.png`;
  return `${HOME_ICON_ROOT}/status-alert-danger.png`;
}

Page({
  data: {
    authed: false,
    loading: true,
    greeting: greetingAt(),
    dateLine: localDateLine(),
    me: null,
    overview: null,
    glucoseCard: null,
    overviewItems: [],
    supportCards: [],
    allMetricsEmpty: true,
    streakMessage: '',
    consentChecked: false,
    nicknamePromptOn: false,
    nicknameDraft: '',
    avatarDraft: '',
    avatarDirty: false,
    processingAvatar: false,
    savingNickname: false,
    savingPendingRecord: false,
    pendingRecordSummary: '',
    pendingRecordTimeText: '',
    pendingRecordError: '',
    promptNicknameAfterLoad: false,
    pendingRecordAfterLoad: false,
    tab: 'home',
    homeOn: 'on',
    historyOn: '',
    statsOn: '',
    mineOn: '',
    navStyle: ''
  },

  onLoad(options = {}) {
    const pending = getPendingRecord();
    const pendingPresentation = this.pendingRecordPresentation(pending);
    this.setData({
      navStyle: getApp().globalData.navStyle,
      consentChecked: hasConsent(),
      promptNicknameAfterLoad: options.promptNickname === '1',
      pendingRecordAfterLoad: options.pendingRecord === '1' || Boolean(pending),
      pendingRecordSummary: pendingPresentation.summary,
      pendingRecordTimeText: pendingPresentation.timeText
    });
  },

  async onShow() {
    syncTabBar(this);
    let data = this.data.authed ? { me: this.data.me, overview: this.data.overview } : null;
    if (!this.isDataFresh()) {
      const refreshed = await this.refresh();
      if (refreshed === false) return;
      data = refreshed;
      this.markDataFresh();
    }
    if (data && this.data.pendingRecordAfterLoad && !this.data.pendingRecordError) {
      await this.savePendingRecord();
    }
    if (data && this.data.promptNicknameAfterLoad) {
      this.setData({ promptNicknameAfterLoad: false });
      this.maybePromptNickname();
    }
  },

  async login() {
    if (!this.data.consentChecked) {
      wx.showToast({ title: '请先阅读并同意用户协议和隐私政策', icon: 'none' });
      return;
    }
    const loggedIn = await doLogin(this, null, { acceptConsent: true });
    if (!loggedIn) return;
    const data = await this.refresh();
    if (data === false) return;
    this.markDataFresh();
    await this.savePendingRecord();
    this.maybePromptNickname();
  },

  async savePendingRecord() {
    if (this.data.savingPendingRecord) return false;
    const pending = getPendingRecord();
    if (!pending || !pending.metric || !pending.data) {
      if (this.data.pendingRecordAfterLoad) this.setData({ pendingRecordAfterLoad: false });
      return false;
    }
    const requestToken = getToken();
    const lease = captureDataLease(requestToken, []);
    try {
      this.setData({ savingPendingRecord: true, pendingRecordError: '' });
      const result = await request(`/api/app/records/${pending.metric}`, { method: 'POST', data: pending.data });
      clearPendingRecord();
      if (!isDataLeaseCurrent(lease, getToken())) {
        this.clearPendingRecordState();
        return false;
      }
      markRecordsChanged();
      this.clearPendingRecordState();
      const refreshed = await this.refresh();
      if (refreshed !== false) this.markDataFresh();
      this.showPendingSaveSuccess(pending, result || {});
      return true;
    } catch (error) {
      const message = error.message || '记录保存失败，请重试';
      const presentation = this.pendingRecordPresentation(pending);
      this.setData({
        pendingRecordAfterLoad: true,
        pendingRecordSummary: presentation.summary,
        pendingRecordTimeText: presentation.timeText,
        pendingRecordError: message
      });
      wx.showToast({ title: message, icon: 'none' });
      return false;
    } finally {
      this.setData({ savingPendingRecord: false });
    }
  },

  pendingRecordPresentation(pending, savedRecord) {
    if (!pending || !pending.metric || !pending.data) return { summary: '', timeText: '' };
    const data = Object.assign({}, pending.data, savedRecord || {});
    let summary = '健康记录';
    if (pending.metric === 'glucose') {
      const value = data.displayValue != null ? data.displayValue : data.value;
      const unit = data.displayUnit || (pending.data.unit === 'mgdl' ? 'mg/dL' : 'mmol/L');
      summary = `血糖 ${value != null ? value : '—'} ${unit}`;
    } else if (pending.metric === 'bp') {
      summary = `血压 ${data.sbp || '—'}/${data.dbp || '—'} mmHg`;
      if (data.pulse) summary += `，脉搏 ${data.pulse}`;
    } else if (pending.metric === 'lipid') {
      const labels = { tc: 'TC', tg: 'TG', ldl: 'LDL-C', hdl: 'HDL-C' };
      const values = Object.keys(labels)
        .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== '')
        .map((key) => `${labels[key]} ${data[key]}`);
      summary = values.length ? `血脂 ${values.join('、')}` : '血脂记录';
    } else if (pending.metric === 'uric') {
      summary = `尿酸 ${data.value != null ? data.value : '—'} μmol/L`;
    }
    const measuredAt = data.measuredAt ? new Date(data.measuredAt) : null;
    const timeText = measuredAt && !Number.isNaN(measuredAt.getTime())
      ? `${fmtMD(measuredAt)} ${fmtTime(measuredAt)}`
      : '刚刚';
    return { summary, timeText };
  },

  clearPendingRecordState() {
    this.setData({
      pendingRecordAfterLoad: false,
      pendingRecordSummary: '',
      pendingRecordTimeText: '',
      pendingRecordError: ''
    });
  },

  showPendingSaveSuccess(pending, result) {
    const presentation = this.pendingRecordPresentation(pending, result.record);
    const status = result.safetyAlert === 'low' ? '明显偏低' : '明显偏高';
    const safetyNotice = result.safetyAlert
      ? `\n\n本次数值${status}，请核对录入是否正确；如有不适，请及时咨询专业医疗机构。`
      : '';
    wx.showModal({
      title: result.safetyAlert ? '记录已保存，请留意' : '记录已保存',
      content: `${presentation.summary}\n记录时间：${presentation.timeText}${safetyNotice}`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  editPendingRecord() {
    if (this.data.savingPendingRecord) return;
    const pending = getPendingRecord();
    if (!pending || !pending.metric || !pending.data) {
      this.clearPendingRecordState();
      wx.showToast({ title: '填写内容已不存在', icon: 'none' });
      return;
    }
    setRecordMetric(pending.metric);
    setRecordReturnPath('/pages/home/index');
    wx.switchTab({
      url: '/pages/record/index',
      success: () => {
        const restore = () => {
          const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
          const recordPage = pages.length ? pages[pages.length - 1] : null;
          if (!recordPage || recordPage.route !== 'pages/record/index' || !this.restorePendingDraft(recordPage, pending)) {
            wx.showToast({ title: '暂时无法恢复填写内容，请重试', icon: 'none' });
            return;
          }
          clearPendingRecord();
          this.clearPendingRecordState();
          if (typeof recordPage.showToast === 'function') {
            recordPage.showToast('填写内容已恢复，请修改后保存');
          }
        };
        if (typeof wx.nextTick === 'function') wx.nextTick(restore);
        else setTimeout(restore, 0);
      },
      fail: () => {
        setRecordMetric('');
        clearRecordReturnPath();
        wx.showToast({ title: '暂时无法返回，请重试', icon: 'none' });
      }
    });
  },

  restorePendingDraft(page, pending) {
    if (!page || typeof page.setData !== 'function' || typeof page.setMetricValue !== 'function') return false;
    const metric = pending.metric;
    const data = pending.data || {};
    if (!metrics.some((item) => item.key === metric)) return false;
    page.setMetricValue(metric);
    const measuredAt = data.measuredAt ? new Date(data.measuredAt) : new Date();
    const safeMeasuredAt = Number.isNaN(measuredAt.getTime()) ? new Date() : measuredAt;
    const patch = {
      dateValue: toDateInput(safeMeasuredAt),
      timeValue: toTimeInput(safeMeasuredAt),
      note: data.note || ''
    };
    const recommendedPeriod = typeof page.inferPeriod === 'function'
      ? page.inferPeriod(metric, safeMeasuredAt)
      : data.period;
    const restoredPeriod = data.period || recommendedPeriod;
    const periodWasManuallySelected = Boolean(restoredPeriod && recommendedPeriod && restoredPeriod !== recommendedPeriod);
    patch.period = restoredPeriod;
    patch.recommendedPeriod = recommendedPeriod;
    patch.periodIsRecommended = restoredPeriod === recommendedPeriod;
    patch.periodRecommended = restoredPeriod === recommendedPeriod;
    patch.periodWasManuallySelected = periodWasManuallySelected;
    patch.periodHintText = typeof page.periodHintText === 'function'
      ? page.periodHintText(restoredPeriod, recommendedPeriod, periodWasManuallySelected)
      : '';
    patch.measurementTimeError = typeof page.measurementTimeError === 'function'
      ? page.measurementTimeError(patch.dateValue, patch.timeValue)
      : '';
    patch.measurementTimeValid = !patch.measurementTimeError;
    if (this.data.me) {
      patch.authed = true;
      patch.me = this.data.me;
    }

    if (metric === 'glucose') {
      let value = data.value;
      const currentUnit = this.data.me && this.data.me.unit
        ? this.data.me.unit
        : (page.data.me && page.data.me.unit ? page.data.me.unit : (data.unit || 'mmol'));
      if (value !== undefined && value !== null && data.unit && currentUnit !== data.unit) {
        value = currentUnit === 'mgdl' ? Math.round(Number(value) * 18) : (Number(value) / 18).toFixed(1);
      }
      const tags = Array.isArray(data.tags) ? data.tags : [];
      patch.value = value == null ? '' : String(value);
      patch.unitText = currentUnit === 'mgdl' ? 'mg/dL' : 'mmol/L';
      patch.tags = tags;
      patch.glucosePeriods = (page.data.glucosePeriods || []).map((item) => Object.assign({}, item, {
        active: item.key === patch.period,
        className: item.key === patch.period ? 'on' : ''
      }));
      patch.glucoseTags = (page.data.glucoseTags || []).map((item) => Object.assign({}, item, {
        active: tags.includes(item.name),
        className: tags.includes(item.name) ? 'on' : ''
      }));
    } else if (metric === 'bp') {
      const tags = Array.isArray(data.tags) ? data.tags : [];
      patch.sbp = data.sbp == null ? '' : String(data.sbp);
      patch.dbp = data.dbp == null ? '' : String(data.dbp);
      patch.pulse = data.pulse == null ? '' : String(data.pulse);
      patch.tags = tags;
      patch.bpPeriods = (page.data.bpPeriods || []).map((item) => Object.assign({}, item, {
        active: item.key === patch.period,
        className: item.key === patch.period ? 'on' : ''
      }));
      patch.bpTags = (page.data.bpTags || []).map((item) => Object.assign({}, item, {
        active: tags.includes(item.name),
        className: tags.includes(item.name) ? 'on' : ''
      }));
    } else if (metric === 'lipid') {
      patch.lipid = {
        tc: data.tc == null ? '' : String(data.tc),
        tg: data.tg == null ? '' : String(data.tg),
        ldl: data.ldl == null ? '' : String(data.ldl),
        hdl: data.hdl == null ? '' : String(data.hdl),
        fasting: data.fasting !== false
      };
      patch.lipidFastingClass = patch.lipid.fasting ? 'on' : '';
    } else {
      patch.value = data.value == null ? '' : String(data.value);
      patch.fasting = data.fasting !== false;
      patch.fastingClass = patch.fasting ? 'on' : '';
    }
    if (typeof page.decimalKeyPatch === 'function') {
      Object.assign(patch, page.decimalKeyPatch(metric, patch.unitText || page.data.unitText));
    }

    page.setData(patch, () => {
      if (metric === 'lipid' && typeof page.updateLipidItems === 'function') page.updateLipidItems();
      if (typeof page.updateLive === 'function') page.updateLive();
      if (typeof page.captureMetricDraft === 'function') page.captureMetricDraft(metric);
    });
    return true;
  },

  discardPendingRecord() {
    if (this.data.savingPendingRecord) return;
    wx.showModal({
      title: '放弃这次记录？',
      content: '填写的内容将被删除，之后无法恢复。',
      cancelText: '继续保留',
      confirmText: '确认放弃',
      confirmColor: '#D6453D',
      success: (result) => {
        if (!result.confirm) return;
        clearPendingRecord();
        this.clearPendingRecordState();
        wx.showToast({ title: '已放弃本次记录', icon: 'none' });
      }
    });
  },

  maybePromptNickname() {
    const me = this.data.me;
    if (me && (me.nickname === '微信用户' || !me.avatarUrl)) {
      this.setData({
        nicknamePromptOn: true,
        nicknameDraft: me.nickname === '微信用户' ? '' : me.nickname,
        avatarDraft: me.avatarUrl || '',
        avatarDirty: false
      });
    }
  },

  async onChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.processingAvatar) return;
    const lease = captureDataLease(getToken(), []);
    try {
      this.setData({ processingAvatar: true });
      const avatarDraft = await prepareAvatar(filePath);
      if (!isDataLeaseCurrent(lease, getToken())) return;
      this.setData({ avatarDraft, avatarDirty: true });
    } catch (error) {
      wx.showToast({ title: error.message || '头像处理失败', icon: 'none' });
    } finally {
      this.setData({ processingAvatar: false });
    }
  },

  onNicknameInput(event) {
    this.setData({ nicknameDraft: event.detail.value });
  },

  skipNickname() {
    this.setData({
      nicknamePromptOn: false,
      nicknameDraft: '',
      avatarDraft: '',
      avatarDirty: false,
      processingAvatar: false,
      savingNickname: false
    });
  },

  async saveNickname(event) {
    const submitted = event && event.detail && event.detail.value && event.detail.value.nickname;
    const nickname = String(submitted || this.data.nicknameDraft || '').trim();
    const updates = {};
    if (nickname) updates.nickname = nickname;
    if (this.data.avatarDirty && this.data.avatarDraft) updates.avatarUrl = this.data.avatarDraft;
    if (!Object.keys(updates).length) {
      wx.showToast({ title: '请选择头像或填写称呼', icon: 'none' });
      return;
    }
    if (this.data.savingNickname || this.data.processingAvatar) return;
    try {
      this.setData({ savingNickname: true });
      const requestToken = getToken();
      const lease = captureDataLease(requestToken, []);
      const updated = await request('/api/app/me', { method: 'PATCH', data: updates });
      if (!isDataLeaseCurrent(lease, getToken())) return;
      const nextMe = Object.assign({}, this.data.me, updated || {}, {
        nickname: (updated && updated.nickname) || nickname || this.data.me.nickname,
        avatarUrl: (updated && updated.avatarUrl) || this.data.me.avatarUrl
      });
      this.setData({
        nicknamePromptOn: false,
        nicknameDraft: '',
        avatarDraft: '',
        avatarDirty: false,
        me: nextMe
      });
      markProfileChanged(getToken(), nextMe);
      this.markDataFresh();
      wx.showToast({ title: '资料已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingNickname: false });
    }
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
    if (
      this._refreshPromise
        && this._refreshLease
        && isDataLeaseCurrent(this._refreshLease, getToken())
    ) return this._refreshPromise;

    const lease = captureDataLease(getToken(), HOME_CACHE_DOMAINS);
    const refreshPromise = this.performRefresh(lease);
    this._refreshPromise = refreshPromise;
    this._refreshLease = lease;
    try {
      return await refreshPromise;
    } finally {
      if (this._refreshPromise === refreshPromise) {
        this._refreshPromise = null;
        this._refreshLease = null;
      }
    }
  },

  async performRefresh(lease) {
    const data = await loadAppData(this);
    if (data === false) {
      if (this.data.loading) this.setData({ loading: false });
      return false;
    }
    if (!isDataLeaseCurrent(lease, getToken())) return false;
    const isDemo = !data;
    const overview = isDemo ? demoOverview() : (data.overview || {});
    const me = isDemo ? demoMe : (data.me || {});
    const cards = metrics.map((metric) => this.decorateMetric(metric, overview[metric.key], me));
    const streak = overview.streak || 0;
    this.setData({
      authed: !isDemo,
      loading: false,
      me,
      overview,
      greeting: greetingAt(),
      dateLine: localDateLine(),
      todayCount: overview.todayCount || 0,
      streak,
      streakMessage: streak > 0
        ? `已经坚持记录 ${streak} 天了，每一次记录都值得肯定，继续保持`
        : '从今天开始记录，慢慢坚持，我们一直陪着您',
      glucoseCard: cards.find((card) => card.isGlucose),
      overviewItems: cards,
      supportCards: cards.filter((card) => card.isBp || card.isUric),
      allMetricsEmpty: cards.every((card) => card.empty)
    });
    return data;
  },

  isDataFresh() {
    return isPageFresh(this, 'home', HOME_CACHE_DOMAINS, getToken());
  },

  markDataFresh() {
    markPageFresh(this, 'home', HOME_CACHE_DOMAINS, getToken());
  },

  decorateMetric(metric, entry, me) {
    const latest = entry && entry.latest;
    if (!latest) {
      return {
        key: metric.key,
        name: metric.name,
        unit: metric.unit,
        isGlucose: metric.key === 'glucose',
        isBp: metric.key === 'bp',
        isUric: metric.key === 'uric',
        empty: true,
        overviewState: 'empty',
        overviewStatusLabel: '未记录',
        overviewIconSrc: overviewIcon(metric.key),
        metricIconSrc: metricIcon(metric.key)
      };
    }
    const status = latest.status || { key: 'ok', label: '达标' };
    const card = {
      key: metric.key,
      name: metric.name,
      unit: metric.unit,
      isGlucose: metric.key === 'glucose',
      isBp: metric.key === 'bp',
      isUric: metric.key === 'uric',
      latest,
      empty: false,
      statusClass: statusClass(status),
      statusStyle: statusStyle(status),
      statusLabel: neutralStatusLabel(status),
      overviewState: status.key === 'ok' ? 'ok' : 'alert',
      overviewStatusLabel: status.key === 'ok' ? '达标' : neutralStatusLabel(status),
      overviewIconSrc: overviewIcon(metric.key, status.key),
      metricIconSrc: metricIcon(metric.key),
      dateText: dayLabel(latest.measuredAt),
      timeText: fmtTime(latest.measuredAt),
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
      card.extraText = latest.pulse ? `脉搏 ${latest.pulse}` : '';
    } else if (metric.key === 'uric') {
      card.valueText = latest.value;
    }
    return card;
  },

  goStats(event) {
    const metric = event.currentTarget.dataset.metric || 'glucose';
    setStatMetric(metric);
    wx.switchTab({
      url: '/pages/stats/index',
      fail: () => setStatMetric('')
    });
  },

  goRecord(event) {
    const metric = event.currentTarget.dataset.metric || 'glucose';
    setRecordMetric(metric);
    setRecordReturnPath('/pages/home/index');
    wx.switchTab({
      url: '/pages/record/index',
      fail: () => {
        setRecordMetric('');
        clearRecordReturnPath();
      }
    });
  }
});
