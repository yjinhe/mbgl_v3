import { z } from 'zod';
import { config } from '../env.js';

const wechatSessionSchema = z.object({
  openid: z.string().min(1).optional(),
  unionid: z.string().min(1).optional(),
  session_key: z.string().min(1).optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional()
});

export class WechatLoginError extends Error {
  constructor(message: string, readonly causeDetail?: unknown) {
    super(message);
    this.name = 'WechatLoginError';
  }
}

export async function resolveWechatOpenid(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (config.wechatMock) return `mock_${code}`;

  return exchangeWechatCode(code, config.wechatAppId, config.wechatSecret, fetchImpl);
}

export async function exchangeWechatCode(
  code: string,
  appId: string,
  secret: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {

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
  } catch (error) {
    throw new WechatLoginError('微信登录服务暂时不可用', error);
  }

  if (!response.ok) {
    throw new WechatLoginError('微信登录服务返回异常', { status: response.status });
  }

  const parsed = wechatSessionSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.errcode || !parsed.data.openid) {
    throw new WechatLoginError('微信登录凭证无效', parsed.success ? parsed.data : parsed.error.flatten());
  }
  return parsed.data.openid;
}
