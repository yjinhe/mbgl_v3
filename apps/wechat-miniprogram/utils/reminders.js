// Measurement reminders built on WeChat one-time subscribe messages
// (docs/WECHAT-REMINDER-SPEC.md). Every subscription request must be started
// synchronously inside the user's tap handler: `requestSubscribe` therefore
// calls `wx.requestSubscribeMessage` before returning its promise, and the
// promise never rejects so a refused or failed dialog can never break saving.
const { getToken, request } = require('./api');
const { periodNames } = require('./metrics');

// 'medication' (docs/WECHAT-MEDICATION-SPEC.md) has no time of its own: the
// server reminds at the times stored on each medication, so its plan only
// carries `enabled` and `quota`.
const REMINDER_METRICS = ['glucose', 'bp', 'medication'];
const TIMELESS_METRICS = ['medication'];
const METRIC_NAMES = { glucose: '血糖', bp: '血压', medication: '服药' };
const DEFAULT_TIMES = { glucose: '07:00', bp: '07:30', medication: '00:00' };
const DEFAULT_GLUCOSE_PERIOD = 'fasting';
const OFFER_DISMISSED_KEY = 'tangji_reminder_offer_dismissed';
const MINIPROGRAM_REQUIRED_MESSAGE = '请先在小程序里微信登录';
const CACHE_TTL_MS = 60 * 1000;
const MAX_TEMPLATES_PER_REQUEST = 3;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

let cache = null;
let inflight = null;

function pad(value) {
  return String(value).padStart(2, '0');
}

function isReminderMetric(metric) {
  return REMINDER_METRICS.includes(metric);
}

function isTime(value) {
  return TIME_PATTERN.test(String(value || ''));
}

function metricName(metric) {
  return METRIC_NAMES[metric] || '';
}

function hasPlanTime(metric) {
  return isReminderMetric(metric) && !TIMELESS_METRICS.includes(metric);
}

function normalizeTemplates(templates) {
  const result = {};
  if (!templates || typeof templates !== 'object') return result;
  for (const metric of REMINDER_METRICS) {
    const id = templates[metric];
    if (typeof id === 'string' && id) result[metric] = id;
  }
  return result;
}

function hasTemplates(templates) {
  return REMINDER_METRICS.some((metric) => Boolean(templates && templates[metric]));
}

// Metrics whose template is configured, in display order.
function templateMetrics(templates) {
  return REMINDER_METRICS.filter((metric) => Boolean(templates && templates[metric]));
}

function normalizePlan(metric, plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const quota = Number(source.quota);
  return {
    metric,
    enabled: Boolean(source.enabled),
    time: isTime(source.time) ? source.time : DEFAULT_TIMES[metric],
    period: metric === 'glucose' ? (source.period || DEFAULT_GLUCOSE_PERIOD) : null,
    quota: Number.isFinite(quota) ? Math.max(0, quota) : 0
  };
}

// Always yields one plan per reminder metric so pages can render both cards
// even before the user has saved anything.
function normalizePlans(plans) {
  const list = Array.isArray(plans) ? plans : [];
  return REMINDER_METRICS.map((metric) => normalizePlan(metric, list.find((plan) => plan && plan.metric === metric)));
}

function normalizeState(data) {
  return {
    plans: normalizePlans(data && data.plans),
    templates: normalizeTemplates(data && data.templates)
  };
}

function emptyState() {
  return normalizeState(null);
}

function planFor(state, metric) {
  const plans = state && Array.isArray(state.plans) ? state.plans : [];
  return plans.find((plan) => plan && plan.metric === metric) || normalizePlan(metric, null);
}

// Metrics that should be asked for quota when the user saves a record:
// enabled plans whose template is configured (spec §3.2).
function enabledTemplateMetrics(state) {
  if (!state) return [];
  return templateMetrics(state.templates).filter((metric) => planFor(state, metric).enabled);
}

function quotaEmptyMetrics(state) {
  return enabledTemplateMetrics(state).filter((metric) => planFor(state, metric).quota <= 0);
}

function invalidateReminders() {
  cache = null;
  inflight = null;
}

function loadReminders(options = {}) {
  const token = getToken();
  if (!token) return Promise.resolve(emptyState());
  if (!options.force && cache && cache.token === token && cache.expiresAt > Date.now()) {
    return Promise.resolve(cache.data);
  }
  if (!options.force && inflight && inflight.token === token) return inflight.promise;
  const clear = () => {
    if (inflight && inflight.promise === promise) inflight = null;
  };
  const promise = request('/api/app/reminders').then((data) => {
    clear();
    const state = normalizeState(data);
    if (getToken() === token) cache = { token, data: state, expiresAt: Date.now() + CACHE_TTL_MS };
    return state;
  }, (error) => {
    clear();
    throw error;
  });
  inflight = { token, promise };
  return promise;
}

function acceptedMetrics(result, metricByTemplate, tmplIds) {
  const accepted = [];
  for (const id of tmplIds) {
    if (result && result[id] === 'accept') accepted.push(metricByTemplate[id]);
  }
  return accepted;
}

// Opens the subscription dialog for the given metrics. Must be called
// synchronously from a tap handler. Resolves `{ accepted: [metric, ...] }`
// and never rejects: reject / ban / filter / API failure all yield `[]`.
function requestSubscribe(templates, metrics) {
  const available = normalizeTemplates(templates);
  const wanted = Array.isArray(metrics) ? metrics : REMINDER_METRICS;
  const metricByTemplate = {};
  const tmplIds = [];
  for (const metric of wanted) {
    const id = available[metric];
    if (!id || metricByTemplate[id]) continue;
    metricByTemplate[id] = metric;
    tmplIds.push(id);
    if (tmplIds.length >= MAX_TEMPLATES_PER_REQUEST) break;
  }
  if (!tmplIds.length || typeof wx === 'undefined' || typeof wx.requestSubscribeMessage !== 'function') {
    return Promise.resolve({ accepted: [] });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      resolve({ accepted });
    };
    try {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (result) => finish(acceptedMetrics(result, metricByTemplate, tmplIds)),
        fail: () => finish([])
      });
    } catch (error) {
      finish([]);
    }
  });
}

// Reports accepted subscriptions so the server can add quota. Errors are
// swallowed: losing one day of quota must never surface as a failure.
function reportSubscriptions(accepted) {
  const list = (Array.isArray(accepted) ? accepted : []).filter(isReminderMetric);
  if (!list.length || !getToken()) return Promise.resolve(null);
  return request('/api/app/reminders/subscriptions', { method: 'POST', data: { accepted: list } })
    .then((data) => {
      invalidateReminders();
      return data && Array.isArray(data.plans) ? normalizePlans(data.plans) : null;
    })
    .catch(() => null);
}

function savePlan(metric, body = {}) {
  if (!isReminderMetric(metric)) return Promise.reject(new Error('暂不支持这种提醒'));
  const data = { enabled: Boolean(body.enabled) };
  if (hasPlanTime(metric)) data.time = isTime(body.time) ? body.time : DEFAULT_TIMES[metric];
  if (metric === 'glucose') data.period = body.period || DEFAULT_GLUCOSE_PERIOD;
  return request(`/api/app/reminders/${metric}`, { method: 'PUT', data }).then((result) => {
    invalidateReminders();
    return normalizePlan(metric, result && result.plan);
  });
}

function readOfferFlags() {
  try {
    const flags = wx.getStorageSync(OFFER_DISMISSED_KEY);
    return flags && typeof flags === 'object' ? flags : {};
  } catch (error) {
    return {};
  }
}

function wasOfferDismissed(metric) {
  return Boolean(readOfferFlags()[metric]);
}

function dismissOffer(metric) {
  if (!isReminderMetric(metric)) return;
  const flags = Object.assign({}, readOfferFlags(), { [metric]: true });
  try {
    wx.setStorageSync(OFFER_DISMISSED_KEY, flags);
  } catch (error) {
    // Local storage may be unavailable; the offer will simply show again.
  }
}

function planSummary(plans) {
  const parts = normalizePlans(plans)
    .filter((plan) => plan.enabled)
    .map((plan) => `${metricName(plan.metric)} ${hasPlanTime(plan.metric) ? plan.time : '已开启'}`);
  return parts.length ? parts.join(' · ') : '未开启';
}

function roundToFiveMinutes(time, fallback = DEFAULT_TIMES.glucose) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  const total = (Math.round((hours * 60 + minutes) / 5) * 5) % (24 * 60);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function offerQuestion(metric) {
  return `要不要每天这个时候提醒您测${metricName(metric)}？`;
}

function enabledPlanText(plan) {
  const normalized = normalizePlan(plan && plan.metric, plan);
  const periodText = normalized.metric === 'glucose' ? (periodNames[normalized.period] || '') : '';
  return `每天 ${normalized.time} 提醒您测${periodText}${metricName(normalized.metric)}。可在「我的 → 测量提醒」修改`;
}

function reminderErrorMessage(error, fallback = '设置失败，请稍后重试') {
  if (error && error.code === 'MINIPROGRAM_REQUIRED') return MINIPROGRAM_REQUIRED_MESSAGE;
  return (error && error.message) || fallback;
}

module.exports = {
  DEFAULT_TIMES,
  MINIPROGRAM_REQUIRED_MESSAGE,
  REMINDER_METRICS,
  dismissOffer,
  enabledPlanText,
  enabledTemplateMetrics,
  hasPlanTime,
  hasTemplates,
  invalidateReminders,
  isReminderMetric,
  loadReminders,
  metricName,
  normalizePlans,
  offerQuestion,
  planFor,
  planSummary,
  quotaEmptyMetrics,
  reminderErrorMessage,
  reportSubscriptions,
  requestSubscribe,
  roundToFiveMinutes,
  savePlan,
  templateMetrics,
  wasOfferDismissed
};
