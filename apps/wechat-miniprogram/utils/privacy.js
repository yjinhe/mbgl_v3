const CONSENT_KEY = 'tangji_privacy_consent';
const CONSENT_VERSION = '2026-08-19';
let consentLoaded = false;
let consentCache = false;

function hasConsent() {
  if (!consentLoaded) {
    consentCache = wx.getStorageSync(CONSENT_KEY) === CONSENT_VERSION;
    consentLoaded = true;
  }
  return consentCache;
}

function saveConsent() {
  wx.setStorageSync(CONSENT_KEY, CONSENT_VERSION);
  consentCache = true;
  consentLoaded = true;
}

function ensurePlatformPrivacyAuthorization() {
  if (typeof wx.getPrivacySetting !== 'function') return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    wx.getPrivacySetting({
      success(setting) {
        if (!setting.needAuthorization) {
          resolve(true);
          return;
        }
        if (typeof wx.requirePrivacyAuthorize !== 'function') {
          reject(new Error('请先阅读并同意微信隐私保护指引'));
          return;
        }
        wx.requirePrivacyAuthorize({
          success: () => resolve(true),
          fail: () => reject(new Error('需要同意隐私保护指引后才能登录'))
        });
      },
      fail: () => reject(new Error('暂时无法获取隐私授权状态，请稍后重试'))
    });
  });
}

function openPrivacyContract() {
  if (typeof wx.openPrivacyContract !== 'function') {
    wx.showToast({ title: '请在微信中查看隐私保护指引', icon: 'none' });
    return;
  }
  wx.openPrivacyContract({
    fail: () => wx.showToast({ title: '暂时无法打开，请稍后重试', icon: 'none' })
  });
}

module.exports = {
  CONSENT_VERSION,
  ensurePlatformPrivacyAuthorization,
  hasConsent,
  openPrivacyContract,
  saveConsent
};
