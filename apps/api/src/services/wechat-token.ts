import { z } from 'zod';
import { config } from '../env.js';

const accessTokenSchema = z.object({
  access_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional()
});

export interface WechatTokenErrorDetail {
  kind: 'not-configured' | 'network' | 'http' | 'wechat' | 'invalid-response';
  status?: number;
  errcode?: number;
}

export class WechatTokenError extends Error {
  constructor(message: string, readonly causeDetail: WechatTokenErrorDetail) {
    super(message);
    this.name = 'WechatTokenError';
  }
}

export interface WechatTokenOptions {
  fetch?: typeof fetch;
  now?: Date;
  appId?: string;
  secret?: string;
}

// Refresh this long before WeChat expires the token, so a token handed out near the end of its life still works.
const REFRESH_MARGIN_SECONDS = 300;
const DEFAULT_EXPIRES_IN_SECONDS = 7200;

let cached: { appId: string; token: string; expiresAt: number } | null = null;

export function resetWechatTokenCache() {
  cached = null;
}

/** Fetches the mini-program client_credential access_token, reusing the cached one until expires_in - 300s. */
export async function getWechatAccessToken(options: WechatTokenOptions = {}): Promise<string> {
  const fetchImpl = options.fetch ?? fetch;
  const nowMs = (options.now ?? new Date()).getTime();
  const appId = options.appId ?? config.wechatAppId;
  const secret = options.secret ?? config.wechatSecret;
  if (!appId || !secret) {
    throw new WechatTokenError('小程序 AppID/Secret 未配置', { kind: 'not-configured' });
  }
  if (cached && cached.appId === appId && cached.expiresAt > nowMs) return cached.token;

  const query = new URLSearchParams({ grant_type: 'client_credential', appid: appId, secret });
  let response: Response;
  try {
    response = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/token?${query}`, {
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new WechatTokenError('微信接口暂时不可用', { kind: 'network' });
  }
  if (!response.ok) {
    throw new WechatTokenError('微信接口返回异常', { kind: 'http', status: response.status });
  }

  const parsed = accessTokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new WechatTokenError('微信 access_token 响应无效', { kind: 'invalid-response' });
  }
  if (parsed.data.errcode || !parsed.data.access_token) {
    throw new WechatTokenError('微信 access_token 获取失败', { kind: 'wechat', errcode: parsed.data.errcode });
  }

  const expiresIn = parsed.data.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS;
  const ttlSeconds = Math.max(0, expiresIn - REFRESH_MARGIN_SECONDS);
  cached = { appId, token: parsed.data.access_token, expiresAt: nowMs + ttlSeconds * 1000 };
  return cached.token;
}
