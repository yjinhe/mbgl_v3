const TAB_ITEMS = [
  { key: 'home', text: '首页', pagePath: 'pages/home/index', url: '/pages/home/index', iconPath: '/assets/home-icons/nav-home.png' },
  { key: 'history', text: '历史', pagePath: 'pages/history/index', url: '/pages/history/index', iconPath: '/assets/home-icons/nav-history.png' },
  { key: 'record', text: '记一笔', pagePath: 'pages/record/index', url: '/pages/record/index', iconPath: '/assets/home-icons/nav-record.png' },
  { key: 'stats', text: '统计', pagePath: 'pages/stats/index', url: '/pages/stats/index', iconPath: '/assets/home-icons/nav-stats.png' },
  { key: 'mine', text: '我的', pagePath: 'pages/mine/index', url: '/pages/mine/index', iconPath: '/assets/home-icons/nav-mine.png' }
];

const navigationIntent = {
  statMetric: '',
  recordMetric: '',
  recordEdit: null,
  recordReturnPath: ''
};

function setStatMetric(metric) {
  navigationIntent.statMetric = String(metric || '');
}

function consumeStatMetric(fallback = '') {
  const metric = navigationIntent.statMetric || fallback;
  navigationIntent.statMetric = '';
  return metric;
}

function setRecordMetric(metric) {
  navigationIntent.recordMetric = String(metric || '');
}

function setRecordEdit(metric, record, token) {
  navigationIntent.recordEdit = record && record.id && token
    ? { metric, record: JSON.parse(JSON.stringify(record)), token }
    : null;
}

function consumeRecordEdit(token) {
  const intent = navigationIntent.recordEdit;
  navigationIntent.recordEdit = null;
  return intent && intent.token === token ? intent : null;
}

function consumeRecordMetric(fallback = '') {
  const metric = navigationIntent.recordMetric || fallback;
  navigationIntent.recordMetric = '';
  return metric;
}

function setRecordReturnPath(path) {
  navigationIntent.recordReturnPath = String(path || '');
}

function consumeRecordReturnPath(fallback = '') {
  const path = navigationIntent.recordReturnPath || fallback;
  navigationIntent.recordReturnPath = '';
  return path;
}

function clearRecordReturnPath() {
  navigationIntent.recordReturnPath = '';
}

function currentRoute() {
  if (typeof getCurrentPages !== 'function') return '';
  const pages = getCurrentPages();
  const current = pages.length ? pages[pages.length - 1] : null;
  return current && current.route ? current.route : '';
}

function selectedTabIndex(route = currentRoute()) {
  return TAB_ITEMS.findIndex((item) => item.pagePath === route);
}

function syncTabBar(page) {
  if (!page || typeof page.getTabBar !== 'function') return;
  const tabBar = page.getTabBar();
  const route = page.route || currentRoute();
  const selected = selectedTabIndex(route);
  if (!tabBar || selected < 0) return;
  const hidden = route === 'pages/record/index';
  const updates = {};
  if (tabBar.data.selected !== selected) updates.selected = selected;
  if (tabBar.data.hidden !== hidden) updates.hidden = hidden;
  if (Object.keys(updates).length) tabBar.setData(updates);
}

module.exports = {
  TAB_ITEMS,
  clearRecordReturnPath,
  consumeRecordMetric,
  consumeRecordEdit,
  consumeRecordReturnPath,
  consumeStatMetric,
  currentRoute,
  selectedTabIndex,
  setRecordMetric,
  setRecordEdit,
  setRecordReturnPath,
  setStatMetric,
  syncTabBar
};
