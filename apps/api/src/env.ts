export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null) throw new Error(`Missing env ${name}`);
  return value;
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

const nodeEnv = env('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
// Fail closed: JWT_SECRET has no fallback and mock WeChat login is opt-in only (never allowed in production).
const jwtSecret = env('JWT_SECRET');
const wechatMock = env('WECHAT_MOCK', 'false') === 'true';
const wechatAppId = optionalEnv('WECHAT_APPID');
const wechatSecret = optionalEnv('WECHAT_SECRET');
const wechatWebAppId = optionalEnv('WECHAT_WEB_APPID');
const wechatWebSecret = optionalEnv('WECHAT_WEB_SECRET');
const webOrigin = env('WEB_ORIGIN', 'http://127.0.0.1:5173,http://127.0.0.1:5174');
const corsOrigins = webOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
const appOrigin = env('APP_ORIGIN', corsOrigins.find((origin) => origin.includes(':5173')) ?? corsOrigins[0]);
const wechatWebRedirectUri = env('WECHAT_WEB_REDIRECT_URI', appOrigin);
const trustProxyHops = integerEnv('TRUST_PROXY_HOPS', isProduction ? 1 : 0, 0, 5);

export interface ReminderTemplate {
  id: string;
  /** Template field keys in message order, copied from the WeChat template detail page. */
  fields: string[];
}

export type MiniprogramState = 'formal' | 'trial' | 'developer';

const MINIPROGRAM_STATES: readonly MiniprogramState[] = ['formal', 'trial', 'developer'];

function templateEnv(idName: string, fieldsName: string, fallbackFields: string, expectedCount: number): ReminderTemplate | undefined {
  const id = optionalEnv(idName);
  const fields = (process.env[fieldsName]?.trim() || fallbackFields).split(',').map((field) => field.trim()).filter(Boolean);
  if (!id) return undefined;
  if (fields.length !== expectedCount || new Set(fields).size !== fields.length) {
    throw new Error(`${fieldsName} must list exactly ${expectedCount} distinct template field keys in message order, e.g. "${fallbackFields}"`);
  }
  return { id, fields };
}

function miniprogramStateEnv(): MiniprogramState {
  const value = env('WECHAT_MINIPROGRAM_STATE', 'formal').trim();
  if (!MINIPROGRAM_STATES.includes(value as MiniprogramState)) {
    throw new Error('WECHAT_MINIPROGRAM_STATE must be one of formal, trial, developer');
  }
  return value as MiniprogramState;
}

const reminderTemplates = {
  glucose: templateEnv('WECHAT_TEMPLATE_GLUCOSE_REMINDER', 'WECHAT_TEMPLATE_GLUCOSE_FIELDS', 'date1,thing2,thing3', 3),
  bp: templateEnv('WECHAT_TEMPLATE_BP_REMINDER', 'WECHAT_TEMPLATE_BP_FIELDS', 'time4,thing2', 2),
  medication: templateEnv('WECHAT_TEMPLATE_MEDICATION_REMINDER', 'WECHAT_TEMPLATE_MEDICATION_FIELDS', 'time1,thing5,thing3', 3)
};
const miniprogramState = miniprogramStateEnv();

if (isProduction && (jwtSecret.includes('change-me') || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be a production secret with at least 32 characters');
}
if (isProduction && wechatMock) {
  throw new Error('WECHAT_MOCK must be false in production');
}
if (Boolean(wechatAppId) !== Boolean(wechatSecret)) {
  throw new Error('WECHAT_APPID and WECHAT_SECRET must be configured together');
}
if (Boolean(wechatWebAppId) !== Boolean(wechatWebSecret)) {
  throw new Error('WECHAT_WEB_APPID and WECHAT_WEB_SECRET must be configured together');
}
if (isProduction && wechatWebAppId && !wechatWebRedirectUri.startsWith('https://')) {
  throw new Error('WECHAT_WEB_REDIRECT_URI must use HTTPS in production');
}
if (isProduction && (corsOrigins.some((origin) => !origin.startsWith('https://')) || !appOrigin.startsWith('https://'))) {
  throw new Error('WEB_ORIGIN and APP_ORIGIN must use HTTPS in production');
}

export const config = {
  nodeEnv,
  isProduction,
  jwtSecret,
  jwtExpiresIn: env('JWT_EXPIRES_IN', '7d'),
  port: Number(env('PORT', '3001')),
  appOrigin,
  webOrigin: appOrigin,
  corsOrigins,
  wechatMock,
  wechatAppId,
  wechatSecret,
  wechatWebAppId,
  wechatWebSecret,
  wechatWebRedirectUri,
  trustProxyHops,
  reminderTemplates,
  miniprogramState,
  globalRateLimit: integerEnv('GLOBAL_RATE_LIMIT', 300, 30, 5000),
  exportMaxRecords: integerEnv('EXPORT_MAX_RECORDS', 10000, 100, 100000),
  logLevel: env('LOG_LEVEL', isProduction ? 'info' : 'warn'),
  appVersion: env('APP_VERSION', '0.1.0'),
  buildSha: env('BUILD_SHA', 'development')
};
