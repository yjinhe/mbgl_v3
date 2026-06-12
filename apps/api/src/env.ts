export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null) throw new Error(`Missing env ${name}`);
  return value;
}

export const config = {
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  port: Number(env('PORT', '3001')),
  webOrigin: env('WEB_ORIGIN', 'http://127.0.0.1:5173'),
  wechatMock: env('WECHAT_MOCK', 'true') === 'true'
};
