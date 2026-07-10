export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null) throw new Error(`Missing env ${name}`);
  return value;
}

const nodeEnv = env('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const jwtSecret = env('JWT_SECRET', 'dev-secret-change-me');
const wechatMock = env('WECHAT_MOCK', isProduction ? 'false' : 'true') === 'true';
const wechatAppId = process.env.WECHAT_APPID?.trim() ?? '';
const wechatSecret = process.env.WECHAT_SECRET?.trim() ?? '';
const webOrigin = env('WEB_ORIGIN', 'http://127.0.0.1:5173,http://127.0.0.1:5174');

if (isProduction && (jwtSecret.includes('change-me') || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be a production secret with at least 32 characters');
}
if (isProduction && wechatMock) {
  throw new Error('WECHAT_MOCK must be false in production');
}
if (!wechatMock && (!wechatAppId || !wechatSecret)) {
  throw new Error('WECHAT_APPID and WECHAT_SECRET are required when WECHAT_MOCK=false');
}

export const config = {
  nodeEnv,
  isProduction,
  jwtSecret,
  jwtExpiresIn: env('JWT_EXPIRES_IN', '7d'),
  port: Number(env('PORT', '3001')),
  webOrigin: webOrigin.split(',')[0]!.trim(),
  corsOrigins: webOrigin.split(',').map((origin) => origin.trim()).filter(Boolean),
  wechatMock,
  wechatAppId,
  wechatSecret,
  logLevel: env('LOG_LEVEL', isProduction ? 'info' : 'warn')
};
