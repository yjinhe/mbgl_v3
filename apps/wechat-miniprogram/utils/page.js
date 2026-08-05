const { getToken, loginWithWechat, request, clearLogin } = require('./api');
const { ensurePlatformPrivacyAuthorization, hasConsent, saveConsent } = require('./privacy');
const { fmtMD, fmtTime, dayLabel } = require('./format');
const { metricByKey, neutralStatusLabel, periodNames, readRecord, statusClass, statusStyle } = require('./metrics');

async function ensureLogin(page) {
  if (getToken() && hasConsent()) return true;
  page.setData({ authed: false, loading: false });
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

async function loadAppData(page) {
  if (!(await ensureLogin(page))) return;
  try {
    page.setData({ loading: true });
    const [me, overview] = await Promise.all([
      request('/api/app/me'),
      request('/api/app/overview')
    ]);
    page.setData({ authed: true, me, overview });
    return { me, overview };
  } catch (error) {
    logoutToLogin(page);
    wx.showToast({ title: error.message || '请重新登录', icon: 'none' });
  } finally {
    page.setData({ loading: false });
  }
}

function decorateRecord(metric, record) {
  const meta = metricByKey(metric);
  const status = Object.assign({}, record.status || {}, { label: neutralStatusLabel(record.status) });
  return Object.assign({}, record, {
    metric,
    metricName: meta.name,
    periodText: periodNames[record.period] || (metric === 'lipid' ? '化验' : ''),
    dayText: dayLabel(record.measuredAt),
    timeText: fmtTime(record.measuredAt),
    dateText: fmtMD(record.measuredAt),
    readText: readRecord(metric, record),
    noteText: record.note || '无备注',
    status,
    statusClass: statusClass(status),
    statusStyle: statusStyle(status),
    statusColorValue: (statusStyle(status).replace('color:', '') || '#7A8A85')
  });
}

module.exports = {
  decorateRecord,
  doLogin,
  ensureLogin,
  loadAppData,
  logoutToLogin
};
