let apiBase = 'https://tangji.aiteam.pw';

const TOKEN_KEY = 'tangji_app_token';
let tokenLoaded = false;
let tokenCache = '';

function setApiBase(base) {
  apiBase = String(base || '').replace(/\/$/, '');
}

function getToken() {
  if (!tokenLoaded) {
    tokenCache = wx.getStorageSync(TOKEN_KEY) || '';
    tokenLoaded = true;
  }
  return tokenCache;
}

function setToken(token) {
  const nextToken = token || '';
  const previousToken = getToken();
  if (nextToken) wx.setStorageSync(TOKEN_KEY, nextToken);
  else wx.removeStorageSync(TOKEN_KEY);
  tokenCache = nextToken;
  tokenLoaded = true;
  if (nextToken !== previousToken) {
    require('./data-cache').resetSessionData();
    require('./record-draft').clearRecordDrafts();
    if (previousToken) wx.removeStorageSync('tangji_pending_record');
  }
}

function request(path, options = {}) {
  const token = getToken();
  const method = String(options.method || 'GET').toUpperCase();
  const hasData = Object.prototype.hasOwnProperty.call(options, 'data')
    && options.data !== undefined;
  const data = !hasData && method !== 'GET' && method !== 'HEAD'
    ? {}
    : options.data;
  const header = Object.assign({ 'content-type': 'application/json' }, options.header || {});
  if (token) header.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}${path}`,
      method,
      // wx.request sends application/json by default. Fastify rejects an empty
      // JSON body on mutation requests before the route handler runs, so send
      // an explicit empty object for DELETE/POST requests without a payload.
      data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data || null);
          return;
        }
        const message = res.data && res.data.error && res.data.error.message
          ? res.data.error.message
          : `请求失败 ${res.statusCode}`;
        const error = new Error(message);
        error.statusCode = res.statusCode;
        error.code = res.data && res.data.error && res.data.error.code
          ? res.data.error.code
          : 'HTTP_ERROR';
        reject(error);
      },
      fail(err) {
        const error = new Error(err.errMsg || '网络异常');
        error.code = 'NETWORK_ERROR';
        reject(error);
      }
    });
  });
}

function download(path) {
  const token = getToken();
  const header = {};
  if (token) header.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${apiBase}${path}`,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res);
          return;
        }
        reject(new Error(`导出失败 ${res.statusCode || ''}`.trim()));
      },
      fail(err) {
        reject(new Error(err.errMsg || '导出失败，请检查网络后重试'));
      }
    });
  });
}

function loginWithWechat() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (loginRes) => {
        try {
          if (!loginRes.code) {
            throw new Error(loginRes.errMsg || 'wx.login 未返回 code');
          }
          const code = loginRes.code;
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
  download,
  getToken,
  loginWithWechat,
  request,
  setApiBase,
  setToken
};
