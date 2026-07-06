let apiBase = 'http://192.168.66.8:3001';

const TOKEN_KEY = 'tangji_app_token';

function setApiBase(base) {
  apiBase = String(base || '').replace(/\/$/, '');
}

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function setToken(token) {
  if (token) wx.setStorageSync(TOKEN_KEY, token);
  else wx.removeStorageSync(TOKEN_KEY);
}

function request(path, options = {}) {
  const token = getToken();
  const header = Object.assign({ 'content-type': 'application/json' }, options.header || {});
  if (token) header.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data || null);
          return;
        }
        const message = res.data && res.data.error && res.data.error.message
          ? res.data.error.message
          : `请求失败 ${res.statusCode}`;
        reject(new Error(message));
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络异常'));
      }
    });
  });
}

function loginWithWechat() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (loginRes) => {
        try {
          const code = loginRes.code || 'seed_demo';
          const data = await request('/api/app/auth/wechat', {
            method: 'POST',
            data: { code }
          });
          setToken(data.token);
          resolve(data);
        } catch (error) {
          reject(error);
        }
      },
      fail() {
        reject(new Error('微信登录失败'));
      }
    });
  });
}

function clearLogin() {
  setToken('');
}

module.exports = {
  clearLogin,
  getToken,
  loginWithWechat,
  request,
  setApiBase,
  setToken
};
