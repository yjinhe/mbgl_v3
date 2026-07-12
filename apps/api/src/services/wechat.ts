import { z } from 'zod';
import { config } from '../env.js';

const wechatSessionSchema = z.object({
  openid: z.string().min(1).optional(),
  unionid: z.string().min(1).optional(),
  session_key: z.string().min(1).optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional()
});

const wechatWebTokenSchema = z.object({
  openid: z.string().min(1).optional(),
  unionid: z.string().min(1).optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional()
});

export interface WechatErrorDetail {
  kind: 'network' | 'http' | 'wechat' | 'invalid-response' | 'identity-conflict' | 'deactivated';
  status?: number;
  errcode?: number;
}

export interface ResolvedWechatIdentity {
  openid: string;
  unionid?: string;
}

export class WechatLoginError extends Error {
  constructor(message: string, readonly causeDetail?: WechatErrorDetail) {
    super(message);
    this.name = 'WechatLoginError';
  }
}

export async function resolveWechatOpenid(code: string, fetchImpl: typeof fetch = fetch): Promise<ResolvedWechatIdentity> {
  const identity = config.wechatMock
    ? { openid: `mock_${code}`, unionid: `mock:${code}` }
    : await exchangeWechatCode(code, config.wechatAppId, config.wechatSecret, fetchImpl);
  if (config.wechatWebAppId && !identity.unionid) {
    throw new WechatLoginError('微信开放平台未返回 UnionID', { kind: 'invalid-response' });
  }
  return identity;
}

export async function resolveWechatWebOpenid(code: string, fetchImpl: typeof fetch = fetch): Promise<ResolvedWechatIdentity> {
  if (config.wechatMock) return { openid: `mock_${code}`, unionid: `mock:${code}` };
  if (!config.wechatWebAppId || !config.wechatWebSecret) {
    throw new WechatLoginError('微信网页授权未配置', { kind: 'invalid-response' });
  }
  const identity = await exchangeWechatWebCode(code, config.wechatWebAppId, config.wechatWebSecret, fetchImpl);
  if (!identity.unionid) {
    throw new WechatLoginError('微信开放平台未返回 UnionID', { kind: 'invalid-response' });
  }
  return identity;
}

export async function exchangeWechatCode(
  code: string,
  appId: string,
  secret: string,
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedWechatIdentity> {

  const query = new URLSearchParams({
    appid: appId,
    secret,
    js_code: code,
    grant_type: 'authorization_code'
  });

  let response: Response;
  try {
    response = await fetchImpl(`https://api.weixin.qq.com/sns/jscode2session?${query}`, {
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new WechatLoginError('微信登录服务暂时不可用', { kind: 'network' });
  }

  if (!response.ok) {
    throw new WechatLoginError('微信登录服务返回异常', { kind: 'http', status: response.status });
  }

  const parsed = wechatSessionSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new WechatLoginError('微信登录凭证无效', { kind: 'invalid-response' });
  }
  if (parsed.data.errcode || !parsed.data.openid) {
    throw new WechatLoginError('微信登录凭证无效', { kind: 'wechat', errcode: parsed.data.errcode });
  }
  return { openid: parsed.data.openid, unionid: parsed.data.unionid };
}

export async function exchangeWechatWebCode(
  code: string,
  appId: string,
  secret: string,
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedWechatIdentity> {
  const query = new URLSearchParams({
    appid: appId,
    secret,
    code,
    grant_type: 'authorization_code'
  });

  let response: Response;
  try {
    response = await fetchImpl(`https://api.weixin.qq.com/sns/oauth2/access_token?${query}`, {
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new WechatLoginError('微信网页授权服务暂时不可用', { kind: 'network' });
  }

  if (!response.ok) {
    throw new WechatLoginError('微信网页授权服务返回异常', { kind: 'http', status: response.status });
  }

  const parsed = wechatWebTokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new WechatLoginError('微信网页授权凭证无效', { kind: 'invalid-response' });
  }
  if (parsed.data.errcode || !parsed.data.openid) {
    throw new WechatLoginError('微信网页授权凭证无效', { kind: 'wechat', errcode: parsed.data.errcode });
  }
  return { openid: parsed.data.openid, unionid: parsed.data.unionid };
}
