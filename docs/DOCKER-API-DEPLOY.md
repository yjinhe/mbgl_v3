# 后端 Docker 部署说明

这份说明用于把 `apps/api` 部署到一台临时 VPS，并让微信小程序通过 HTTPS 域名访问后端。

## 适用边界

- 当前方案只容器化后端 API。
- 数据库沿用 SQLite，并通过 Docker volume 持久化到 `/data/prod.db`。
- 容器构建时执行 TypeScript 检查，运行时使用编译后的 `dist/src/server.js`。
- 适合体验版、临时演示、少量测试用户。
- 如果进入正式长期运营，建议迁移到 PostgreSQL 或托管数据库并配置自动备份。

## 服务器准备

VPS 需要安装 Docker 和 Docker Compose 插件。Ubuntu 示例：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

## 上传代码

推荐直接在 VPS 上拉仓库：

```bash
mkdir -p /opt/tangji
cd /opt/tangji
git clone <你的仓库地址> mbgl_v3
cd mbgl_v3
```

如果没有远程仓库，可以把当前目录压缩后上传到 VPS，再解压到 `/opt/tangji/mbgl_v3`。

## 配置环境变量

```bash
cp .env.docker.example .env.docker
nano .env.docker
```

生产最小配置：

```env
SEED_ON_BOOT=false
ALLOW_DESTRUCTIVE_SEED=false
BASELINE_INITIAL_MIGRATION=false
WECHAT_MOCK=false
JWT_SECRET=使用 openssl rand -hex 32 生成
JWT_EXPIRES_IN=7d
WECHAT_APPID=你的小程序AppID
WECHAT_SECRET=你的小程序AppSecret
WEB_ORIGIN=https://console.example.com
TZ=Asia/Shanghai
ADMIN_INIT_USERNAME=admin
ADMIN_INIT_PASSWORD=至少12位的初始密码
```

全新数据库启动后创建首个管理员，不需要 seed：

```bash
docker compose -f docker-compose.api.yml exec tangji-api pnpm --filter @tangji/api admin:bootstrap
```

演示 seed 会清空全部业务数据，只允许对一次性数据库显式执行：

```bash
docker compose -f docker-compose.api.yml run --rm -e SEED_ON_BOOT=true -e ALLOW_DESTRUCTIVE_SEED=true tangji-api true
```

旧版本通过 `prisma db push` 创建的数据库，首次升级 migration 前先备份，临时设置 `BASELINE_INITIAL_MIGRATION=true` 启动一次，成功后立即改回 `false`。

## 启动后端容器

```bash
docker compose -f docker-compose.api.yml up -d --build
```

查看日志：

```bash
docker compose -f docker-compose.api.yml logs -f tangji-api
```

检查健康接口：

```bash
curl http://127.0.0.1:3001/health
```

预期返回：

```json
{"ok":true}
```

## 配置 Nginx 反代

假设临时域名为 `api.example.com`，先把 DNS A 记录解析到 VPS IP。

创建 Nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/tangji-api
```

写入：

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/tangji-api /etc/nginx/sites-enabled/tangji-api
sudo nginx -t
sudo systemctl reload nginx
```

## 配置 HTTPS

微信小程序正式环境必须使用 HTTPS 域名，不能直接请求 IP 或 HTTP。

如果域名已解析到 VPS，可以用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

验证：

```bash
curl https://api.example.com/health
```

## 修改小程序 API 地址

修改：

```text
apps/wechat-miniprogram/app.js
```

把：

```js
apiBase: 'https://tangji.aiteam.pw'
```

改成：

```js
apiBase: 'https://api.example.com'
```

然后用微信开发者工具上传体验版。

## 微信后台配置

在微信公众平台配置：

```text
开发管理 → 开发设置 → 服务器域名
```

至少添加：

```text
request 合法域名：https://api.example.com
downloadFile 合法域名：https://api.example.com
```

注意：正式发布通常要求域名备案。国外 VPS 临时解析适合体验版或内部测试；如果提交正式审核，域名、备案和类目资质仍可能成为问题。

## 常用运维命令

```bash
# 启动或更新
docker compose -f docker-compose.api.yml up -d --build

# 查看状态
docker compose -f docker-compose.api.yml ps

# 查看日志
docker compose -f docker-compose.api.yml logs -f tangji-api

# 停止
docker compose -f docker-compose.api.yml down

# 查看持久化卷
docker volume ls | grep tangji

# 备份 SQLite 数据库（先停止 API 写入）
docker compose -f docker-compose.api.yml stop tangji-api
docker run --rm -v mbgl_v3_tangji_api_data:/data -v "$PWD":/backup busybox cp /data/prod.db /backup/prod.db.backup
docker compose -f docker-compose.api.yml start tangji-api
```

## 小程序体验版验收路径

1. 打开体验版小程序。
2. 微信登录或 mock 登录。
3. 首页能加载四指标。
4. 录入一条血压或血糖记录。
5. 查看历史、统计、回收站。
6. 如果保留药房能力，测试绑定邀请码 `KN23DEMO`。
7. 在药房后台或 API 测试客户数据是否可见。

## 关键提醒

- 国外 VPS 访问速度和稳定性可能影响小程序体验。
- 微信正式发布环境要求 HTTPS 合法域名，且通常要求备案域名。
- 体验版可用于临时验证，但不要把 mock 登录和演示数据当作正式生产配置。
- 当前 SQLite 方案适合临时部署；正式长期使用建议迁移 PostgreSQL。
