const { getToken, loginWithWechat, request, clearLogin } = require('./api');
const { getMeCached } = require('./data-cache');
const { ensurePlatformPrivacyAuthorization, hasConsent, saveConsent } = require('./privacy');
const { fmtMD, fmtTime, dayLabel } = require('./format');
const { metricByKey, neutralStatusLabel, periodNames, readRecord, statusClass, statusStyle } = require('./metrics');

const PENDING_RECORD_KEY = 'tangji_pending_record';

function shouldClearLogin(error, requestToken) {
  return Boolean(
    requestToken
      && getToken() === requestToken
      && (error.statusCode === 401 || error.statusCode === 403)
  );
}

async function ensureLogin(page) {
  if (getToken() && hasConsent()) return true;
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
      wx.setStorageSync(PENDING_RECORD_KEY, pendingRecord);
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
    const authExpired = shouldClearLogin(error, requestToken);
    if (authExpired) {
      logoutToLogin(page);
      wx.reLaunch({ url: '/pages/home/index' });
    }
    wx.showToast({
      title: authExpired ? '请重新登录' : (error.message || '加载失败，请稍后重试'),
      icon: 'none'
    });
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
    const authExpired = shouldClearLogin(error, requestToken);
    if (authExpired) {
      logoutToLogin(page);
      wx.reLaunch({ url: '/pages/home/index' });
    }
    wx.showToast({
      title: authExpired ? '请重新登录' : (error.message || '加载失败，请稍后重试'),
      icon: 'none'
    });
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
  getPendingRecord,
  loadAppData,
  loadMe,
  logoutToLogin,
  promptLoginForAction
};
