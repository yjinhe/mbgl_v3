const { getToken, loginWithWechat, request, clearLogin } = require('./api');
const { fmtMD, fmtTime, dayLabel } = require('./format');
const { metricByKey, periodNames, readRecord, statusClass, statusStyle } = require('./metrics');

async function ensureLogin(page) {
  if (getToken()) return true;
  page.setData({ authed: false, loading: false });
  return false;
}

async function doLogin(page, afterLogin) {
  try {
    page.setData({ loading: true });
    await loginWithWechat();
    page.setData({ authed: true });
    if (afterLogin) await afterLogin();
  } catch (error) {
    wx.showToast({ title: error.message || '登录失败', icon: 'none' });
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
  return Object.assign({}, record, {
    metric,
    metricName: meta.name,
    periodText: periodNames[record.period] || (metric === 'lipid' ? '化验' : ''),
    dayText: dayLabel(record.measuredAt),
    timeText: fmtTime(record.measuredAt),
    dateText: fmtMD(record.measuredAt),
    readText: readRecord(metric, record),
    noteText: record.note || '无备注',
    statusClass: statusClass(record.status),
    statusStyle: statusStyle(record.status),
    statusColorValue: (statusStyle(record.status).replace('color:', '') || '#7A8A85')
  });
}

module.exports = {
  decorateRecord,
  doLogin,
  ensureLogin,
  loadAppData,
  logoutToLogin
};
