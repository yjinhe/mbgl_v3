# 后端 Docker 部署说明

这份说明用于只部署 `apps/api`。通用的备份、恢复、版本发布、回滚和旧库迁移流程见 [DOCKER-OPERATIONS.md](./DOCKER-OPERATIONS.md)，生产操作必须同时遵循该文档。

## 部署边界

- API 使用 Node.js 22 和 Prisma，SQLite 数据位于持久卷 `/data/prod.db`。
- 宿主机端口固定为 `127.0.0.1:3001`，不能从公网绕过 HTTPS 反向代理访问。
- 容器启动前检查 SQLite 完整性和 migration 状态，检查失败时不会启动服务。
- SQLite 适合小规模运营；用户量或并发写入增长后应迁移到托管数据库。

## 前置要求

- Docker Engine 和 Docker Compose v2.20 或更高版本。
- 一个已备案并在微信公众平台登记的 HTTPS 域名。
- 服务器防火墙只开放 `80/443`，不要开放 `3001`。

## 配置

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

至少填写以下生产值：

```env
SEED_ON_BOOT=false
ALLOW_DESTRUCTIVE_SEED=false
BASELINE_INITIAL_MIGRATION=false
WECHAT_MOCK=false
# 小程序为可选渠道，启用时成对填写
WECHAT_APPID=
WECHAT_SECRET=
# 微信网页授权为可选登录方式，启用时成对填写
WECHAT_WEB_APPID=
WECHAT_WEB_SECRET=
WECHAT_WEB_REDIRECT_URI=https://app.example.com
JWT_SECRET=使用 openssl rand -hex 32 生成
JWT_EXPIRES_IN=7d
WEB_ORIGIN=https://app.example.com,https://console.example.com
APP_ORIGIN=https://app.example.com
TRUST_PROXY_HOPS=1
ADMIN_INIT_USERNAME=admin
ADMIN_INIT_PASSWORD=至少12位的随机初始密码
```

`APP_VERSION` 和 `BUILD_SHA` 会由发布脚本固化进不可变镜像，不能在 `.env.docker` 中覆盖；`IMAGE_TAG` 由发布脚本选择。不要把 `.env.docker` 提交到 Git。

### 小程序测量提醒（可选）

测量提醒通过微信一次性订阅消息下发（规格见 `docs/WECHAT-REMINDER-SPEC.md`），依赖 `WECHAT_APPID/WECHAT_SECRET`。在 `.env.docker` 中填入 `WECHAT_TEMPLATE_GLUCOSE_REMINDER` 与 `WECHAT_TEMPLATE_BP_REMINDER`（公众平台「我的模板」里的模板 ID）后，API 每 5 分钟（东八区）扫描到点计划并发送。`WECHAT_TEMPLATE_GLUCOSE_FIELDS`（默认 `date1,thing2,thing3`，顺序为测量时间、测量时段、温馨提示）和 `WECHAT_TEMPLATE_BP_FIELDS`（默认 `time4,thing2`，顺序为提醒时间、备注）是模板字段 key，默认值已于 2026-09-08 按公众平台「我的模板 → 详情」核对，换模板时需同步修改；字段数量不对时 API 启动即报错，key 写错时发送会返回 errcode 47003。体验版联调期间把 `WECHAT_MINIPROGRAM_STATE` 设为 `trial`，验证收到消息后改回 `formal`。模板 ID 留空时提醒功能整体关闭，小程序会隐藏相关入口，其余功能不受影响。服药提醒（规格见 `docs/WECHAT-MEDICATION-SPEC.md`）复用同一机制：填入 `WECHAT_TEMPLATE_MEDICATION_REMINDER` 后，同一个定时任务会按用户常用药里的时间点合并发送；`WECHAT_TEMPLATE_MEDICATION_FIELDS`（默认 `time1,thing5,thing3`，顺序为服药时间、药品、提示说明）同样已核对，模板 ID 留空时小程序只隐藏服药提醒开关，常用药记录与打勾功能不受影响。

## 首次发布

从一个已审核的 Git tag 或提交发布，不要直接部署未提交的工作区：

```bash
COMPOSE_FILE=docker-compose.api.yml docker/release.sh v1.0.0
```

脚本会依次校验配置、为已有数据库生成备份、构建带版本标签的镜像、执行 migration，并等待健康检查通过。全新数据库启动后创建首个管理员：

```bash
docker compose --env-file .env.docker -f docker-compose.api.yml exec tangji-api \
  pnpm --filter @tangji/api admin:bootstrap
```

不要在生产库执行 seed。seed 会清空业务数据，只能用于明确标记为可丢弃的演示环境。

## HTTPS 反向代理

下面的 Nginx 位于宿主机并且是唯一可信代理。`X-Forwarded-For` 必须覆盖为直接客户端地址，不能追加客户端传入的同名请求头。

```nginx
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
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

证书可使用 Certbot 签发：

```bash
sudo certbot --nginx -d api.example.com
sudo nginx -t
sudo systemctl reload nginx
```

## 验收

```bash
curl --fail http://127.0.0.1:3001/health
curl --fail https://api.example.com/health
docker compose --env-file .env.docker -f docker-compose.api.yml ps
ss -lnt | grep 3001
```

健康响应应包含 `ok`、`version` 和 `buildSha`；`ss` 输出必须是 `127.0.0.1:3001`，不能是 `0.0.0.0:3001`。

最后在微信公众平台把 `https://api.example.com` 添加到 `request` 和 `downloadFile` 合法域名，并用体验版完成登录、录入、查询、药房授权和撤销授权流程。
