const { getToken, setApiBase } = require('./utils/api');

function safeWxCall(fn, fallback) {
  try {
    return fn();
  } catch (error) {
    return fallback;
  }
}

App({
  globalData: {
    apiBase: 'http://192.168.66.8:3001',
    me: null,
    navStyle: ''
  },

  onLaunch() {
    setApiBase(this.globalData.apiBase);
    this.globalData.token = getToken();
    this.globalData.navStyle = this.computeNavStyle();
  },

  computeNavStyle() {
    const windowInfo = safeWxCall(() => wx.getWindowInfo && wx.getWindowInfo(), null) || {};
    const system = safeWxCall(() => wx.getSystemInfoSync(), {}) || {};
    const capsule = safeWxCall(() => wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect(), null);
    const statusBarHeight = windowInfo.statusBarHeight || system.statusBarHeight || 24;
    const windowWidth = windowInfo.windowWidth || system.windowWidth || system.screenWidth || 375;
    const buttonHeight = capsule && capsule.height ? capsule.height : 32;
    const buttonTop = capsule && capsule.top ? capsule.top : statusBarHeight + 6;
    const navGap = Math.max(4, buttonTop - statusBarHeight);
    const navHeight = statusBarHeight + buttonHeight + navGap * 2;
    const menuRight = capsule && capsule.left ? Math.max(96, windowWidth - capsule.left + 12) : 116;
    return `padding-top:${statusBarHeight}px;height:${navHeight}px;padding-right:${menuRight}px`;
  }
});
