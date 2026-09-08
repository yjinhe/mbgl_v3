const { getToken, loginWithWechat, request, clearLogin } = require('./api');
const { getMeCached } = require('./data-cache');
const { ensurePlatformPrivacyAuthorization, hasConsent, saveConsent } = require('./privacy');
const { fmtMD, fmtTime, dayLabel } = require('./format');
const { metricByKey, neutralStatusLabel, periodNames, readRecord, statusClass, statusStyle } = require('./metrics');

const PENDING_RECORD_KEY = 'tangji_pending_record';
const ERROR_MESSAGES = {
  UNAUTHORIZED: '登录已过期，请重新登录',
  FORBIDDEN: '没有权限',
  NOT_FOUND: '记录不存在或已删除'
};
let consentUpdatePrompted = false;

function shouldClearLogin(error, requestToken) {
  return Boolean(
    requestToken
      && getToken() === requestToken
      && (error.statusCode === 401 || error.statusCode === 403)
  );
}

function friendlyErrorMessage(error, fallback = '加载失败，请稍后重试') {
  const code = error && error.code;
  const message = error && error.message;
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (message && ERROR_MESSAGES[message]) return ERROR_MESSAGES[message];
  return message || fallback;
}

// Logs out and returns to the home page when a request failed because the
// current login is no longer valid. Returns true when it handled the error so
// callers can stop rendering the failure. `options.pendingRecord` keeps an
// unsaved new record so it is submitted automatically after re-login.
function handleRequestError(page, error, requestToken, options = {}) {
  if (!shouldClearLogin(error, requestToken)) return false;
  logoutToLogin(page);
  const pendingRecord = options.pendingRecord || null;
  if (pendingRecord) setPendingRecord(pendingRecord);
  wx.showToast({
    title: pendingRecord ? '登录已过期，重新登录后会自动保存本次记录' : friendlyErrorMessage(error, '登录已过期，请重新登录'),
    icon: 'none'
  });
  wx.reLaunch({ url: pendingRecord ? '/pages/home/index?pendingRecord=1' : '/pages/home/index' });
  return true;
}

// The privacy policy version changed after this device agreed to it. Explain
// once per launch and send the user to the home page, where the login card
// asks for consent again; other pages fall back to demo data meanwhile.
function promptConsentUpdate() {
  if (consentUpdatePrompted) return;
  consentUpdatePrompted = true;
  wx.showModal({
    title: '隐私政策已更新',
    content: '隐私政策已更新，请重新确认',
    cancelText: '稍后',
    confirmText: '去确认',
    confirmColor: '#0E7E6B',
    success: (result) => {
      if (!result.confirm) return;
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const current = pages.length ? pages[pages.length - 1] : null;
      if (current && current.route === 'pages/home/index') return;
      wx.switchTab({ url: '/pages/home/index' });
    }
  });
}

async function ensureLogin(page) {
  const token = getToken();
  if (token && hasConsent()) return true;
  if (token) promptConsentUpdate();
  if (page.data.authed || page.data.loading) {
    page.setData({ authed: false, loading: false });
  }
  return false;
}

async function doLogin(page, afterLogin, options = {}) {
  if (options.acceptConsent) saveConsent();
  if (!hasConsent()) {
    wx.showToast({ title: '请先阅读并同意用户协议和隐私政策', icon: 'none' });
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const current = pages.length ? pages[pages.length - 1] : null;
    if (current && current.route !== 'pages/home/index') {
      wx.reLaunch({ url: '/pages/home/index' });
    }
    return false;
  }
  try {
    page.setData({ loading: true });
    await ensurePlatformPrivacyAuthorization();
    await loginWithWechat();
    page.setData({ authed: true });
    if (afterLogin) await afterLogin();
    return true;
  } catch (error) {
    wx.showToast({ title: error.message || '登录失败', icon: 'none' });
    return false;
  } finally {
    page.setData({ loading: false });
  }
}

function logoutToLogin(page) {
  clearLogin();
  page.setData({ authed: false, me: null, overview: null, records: {} });
}

function getPendingRecord() {
  return wx.getStorageSync(PENDING_RECORD_KEY) || null;
}

function setPendingRecord(pendingRecord) {
  wx.setStorageSync(PENDING_RECORD_KEY, pendingRecord);
}

function clearPendingRecord() {
  wx.removeStorageSync(PENDING_RECORD_KEY);
}

function promptLoginForAction(pendingRecord) {
  wx.showModal({
    title: '登录后保存',
    content: '当前为功能演示。去登录后，本次填写内容会自动保存到个人账号。',
    cancelText: '继续体验',
    confirmText: '去登录并保存',
    confirmColor: '#0E7E6B',
    success: (result) => {
      if (!result.confirm) return;
      setPendingRecord(pendingRecord);
      wx.reLaunch({ url: '/pages/home/index?pendingRecord=1' });
    }
  });
}

async function loadAppData(page) {
  if (!(await ensureLogin(page))) return;
  const requestToken = getToken();
  try {
    const [me, overview] = await Promise.all([
      fetchMe(),
      request('/api/app/overview')
    ]);
    return { me, overview };
  } catch (error) {
    if (handleRequestError(page, error, requestToken)) return false;
    wx.showToast({ title: friendlyErrorMessage(error), icon: 'none' });
    return false;
  }
}

function fetchMe(options = {}) {
  const token = getToken();
  if (!token) return Promise.resolve(null);
  return getMeCached(token, () => request('/api/app/me'), options);
}

async function loadMe(page, options = {}) {
  if (!(await ensureLogin(page))) return;
  const requestToken = getToken();
  try {
    const me = await fetchMe(options);
    if (options.apply !== false) page.setData({ authed: true, me });
    return me;
  } catch (error) {
    if (handleRequestError(page, error, requestToken)) return false;
    wx.showToast({ title: friendlyErrorMessage(error), icon: 'none' });
    return false;
  }
}

function decorateRecord(metric, record, unit = 'mmol') {
  const meta = metricByKey(metric);
  const status = Object.assign({}, record.status || {}, { label: neutralStatusLabel(record.status) });
  return Object.assign({}, record, {
    metric,
    metricName: meta.name,
    periodText: periodNames[record.period] || (metric === 'lipid' ? '化验' : ''),
    dayText: dayLabel(record.measuredAt),
    timeText: fmtTime(record.measuredAt),
    dateText: fmtMD(record.measuredAt),
    readText: readRecord(metric, record, unit),
    hasNote: Boolean(record.note),
    noteText: record.note || '无备注',
    status,
    statusClass: statusClass(status),
    statusStyle: statusStyle(status),
    statusColorValue: (statusStyle(status).replace('color:', '') || '#7A8A85')
  });
}

module.exports = {
  clearPendingRecord,
  decorateRecord,
  doLogin,
  ensureLogin,
  fetchMe,
  friendlyErrorMessage,
  getPendingRecord,
  handleRequestError,
  loadAppData,
  loadMe,
  logoutToLogin,
  promptLoginForAction,
  setPendingRecord,
  shouldClearLogin
};
