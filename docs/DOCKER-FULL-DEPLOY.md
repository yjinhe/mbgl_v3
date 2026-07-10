# 全栈 Docker 部署说明

这份说明用于在一台 VPS 上统一部署：

- C 端 Web：`apps/web`
- 药房/平台后台：`apps/console`
- 后端 API：`apps/api`

## 部署形态

`docker-compose.yml` 会启动两个容器：

- `tangji-api`：Fastify + Prisma API，SQLite 数据持久化在 Docker volume `/data/prod.db`
- `tangji-frontends`：Nginx 静态托管两个 Vite build

端口绑定到宿主机本地回环地址，适合再由 VPS 上的 Nginx/Caddy 统一做 HTTPS：

| 宿主机端口 | 服务 |
| --- | --- |
| `127.0.0.1:5173` | C 端 Web |
| `127.0.0.1:5174` | 药房/平台后台 |
| `127.0.0.1:3001` | API 直连入口 |

C 端和后台容器内都配置了 `/api/` 反代到 `tangji-api:3001`。因此前端构建时不需要设置 `VITE_API_BASE`，浏览器会请求同域 `/api/...`。

## 环境变量

```bash
cp .env.docker.example .env.docker
nano .env.docker
```

生产配置示例：

```env
SEED_ON_BOOT=false
ALLOW_DESTRUCTIVE_SEED=false
BASELINE_INITIAL_MIGRATION=false
WECHAT_MOCK=false
WECHAT_APPID=你的小程序AppID
WECHAT_SECRET=你的小程序AppSecret
JWT_SECRET=使用 openssl rand -hex 32 生成
JWT_EXPIRES_IN=7d
WEB_ORIGIN=https://app.example.com,https://console.example.com
TZ=Asia/Shanghai
ADMIN_INIT_USERNAME=admin
ADMIN_INIT_PASSWORD=至少12位的初始密码
```

生产环境禁止 `WECHAT_MOCK=true`。全新数据库启动后，用非破坏性命令创建首个管理员：

```bash
docker compose exec tangji-api pnpm --filter @tangji/api admin:bootstrap
```

只有一次性演示数据库需要 seed；seed 会清空全部业务数据，必须同时显式开启两个开关：

```bash
docker compose run --rm -e SEED_ON_BOOT=true -e ALLOW_DESTRUCTIVE_SEED=true tangji-api true
```

旧版本通过 `prisma db push` 创建的现有数据库，升级前先备份，并在首次启动时临时设置 `BASELINE_INITIAL_MIGRATION=true`。启动成功后立刻改回 `false`，后续由 `prisma migrate deploy` 管理结构。

## 构建和启动

```bash
docker compose up -d --build
```

或使用 npm 脚本：

```bash
pnpm docker:build
pnpm docker:up
pnpm docker:logs
```

检查本机服务：

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:5173/
curl http://127.0.0.1:5174/
```

## Nginx HTTPS 示例

假设三个域名：

- `app.example.com`：C 端 Web，也可作为小程序 API base
- `console.example.com`：药房后台
- `api.example.com`：API 直连域名，可选

```nginx
server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name console.example.com;

    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

签发 HTTPS：

```bash
sudo certbot --nginx -d app.example.com -d console.example.com -d api.example.com
```

如果小程序只使用 `app.example.com`，把 `apps/wechat-miniprogram/app.js` 的 `apiBase` 改成：

```js
apiBase: 'https://app.example.com'
```

因为 C 端站点的 Nginx 已经代理 `/api/`，小程序请求 `https://app.example.com/api/...` 可以直接到后端。

## 常用命令

```bash
# 更新部署
docker compose up -d --build

# 查看日志
docker compose logs -f

# 只看后端日志
docker compose logs -f tangji-api

# 只看前端 Nginx 日志
docker compose logs -f tangji-frontends

# 停止容器，不删除数据库 volume
docker compose down

# 备份 SQLite（短暂停止写入，避免复制到不一致状态）
docker compose stop tangji-api
docker run --rm -v mbgl_v3_tangji_api_data:/data -v "$PWD":/backup busybox cp /data/prod.db /backup/prod.db.backup
docker compose start tangji-api
```

## 注意事项

- 当前全栈部署仍使用 SQLite，适合演示、体验版、小规模测试。
- API 镜像会先完成 TypeScript build，再以非 root 用户运行编译产物。
- 长期正式运营建议迁移 PostgreSQL 或托管数据库，并配置自动异地备份。
- 国外 VPS 可做体验版联调；微信小程序正式发布通常还涉及 HTTPS 合法域名、备案和类目资质要求。
