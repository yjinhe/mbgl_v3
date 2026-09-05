# 全栈 Docker 部署说明

这份说明用于统一部署 C 端 Web、药房后台和 API。生产操作、备份、恢复与回滚见 [DOCKER-OPERATIONS.md](./DOCKER-OPERATIONS.md)。

## 部署形态

`docker-compose.yml` 启动两个容器：

- `tangji-api`：Node.js 22 + Fastify + Prisma，SQLite 持久化在 `/data/prod.db`。
- `tangji-frontends`：Nginx 托管两套静态前端，并将 `/api/` 转发给 API。

所有宿主机端口仅绑定本地回环地址：

| 地址 | 服务 |
| --- | --- |
| `127.0.0.1:5173` | C 端 Web |
| `127.0.0.1:5174` | 药房/平台后台 |
| `127.0.0.1:3001` | API 运维入口 |

公网只开放宿主机 HTTPS 反向代理的 `443`。前端容器的健康检查同时验证两套页面和 API，因此 API 不可用时整套发布不会被标记为健康。

## 配置与发布

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
nano .env.docker
docker/release.sh v1.0.0
```

生产必须设置强随机 `JWT_SECRET` 以及准确的 `APP_ORIGIN/WEB_ORIGIN`。账号密码是 Web 主登录通道，不依赖微信配置。API 经一层受信任代理时保持 `TRUST_PROXY_HOPS=1`，并保持以下开关关闭：

代理信任同时校验跳数与地址：仅接受回环地址、RFC1918 私有 IPv4 和私有 IPv6 网段。保持 API 宿主机端口绑定 `127.0.0.1`、前端与 API 使用隔离 Docker 网络；不要把 API 直接开放给公网或不受信任的内网客户端。使用公网地址代理的其它拓扑需先显式调整信任策略，不能仅增加跳数。

```env
APP_ORIGIN=https://app.example.com
WEB_ORIGIN=https://app.example.com,https://console.example.com
```

小程序的 `WECHAT_APPID/WECHAT_SECRET` 和微信网页授权的 `WECHAT_WEB_APPID/WECHAT_WEB_SECRET` 都是可选的，但每组必须成对填写。启用微信网页授权时，`WECHAT_WEB_REDIRECT_URI` 必须使用 HTTPS 并与 `APP_ORIGIN` 同源。

如果同时启用小程序和公众号登录，两者必须绑定到同一个微信开放平台账号。API 会用 `UnionID` 合并微信身份；未返回 `UnionID` 时登录会失败，避免账号被静默拆分。

```env
WECHAT_MOCK=false
SEED_ON_BOOT=false
ALLOW_DESTRUCTIVE_SEED=false
BASELINE_INITIAL_MIGRATION=false
```

全新数据库在发布成功后执行一次管理员初始化：

```bash
docker compose --env-file .env.docker exec tangji-api \
  pnpm --filter @tangji/api admin:bootstrap
```

## 宿主机 Nginx

以下示例假设 `app.example.com` 和 `console.example.com` 已配置证书。外层代理必须覆盖转发 IP 请求头，不能使用 `$proxy_add_x_forwarded_for` 接受不可信客户端链。

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen 443 ssl http2;
    server_name console.example.com;

    ssl_certificate /etc/letsencrypt/live/console.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/console.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

HTTP 的 `80` 端口只用于跳转到 HTTPS。响应安全头由前端容器统一添加，包括 CSP、HSTS、防嵌入和 MIME 嗅探保护。

## 发布验收

```bash
curl --fail http://127.0.0.1:5173/
curl --fail http://127.0.0.1:5174/
curl --fail http://127.0.0.1:3001/health
curl --fail http://127.0.0.1:5173/build.json
curl -I https://app.example.com/
docker compose --env-file .env.docker ps
```

确认以下结果：

1. 两个容器均为 `healthy`。
2. `/health` 和 `/build.json` 的版本、提交号与本次发布一致。
3. 公网响应包含 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Content-Type-Options` 和 `X-Frame-Options`。
4. `3001/5173/5174` 均只监听 `127.0.0.1`。
5. 浏览器和小程序完成真实微信登录、数据录入、授权与撤销授权验收。
