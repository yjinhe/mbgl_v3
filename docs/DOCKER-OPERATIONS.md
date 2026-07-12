# Docker 生产运维手册

本手册适用于 `docker-compose.yml` 和 `docker-compose.api.yml`。以下命令默认在仓库根目录运行，API-only 部署需在命令前增加 `COMPOSE_FILE=docker-compose.api.yml`。

## 发布原则

- 只发布已审核、已提交的 Git 状态，镜像使用不可变版本号或提交号，不使用 `latest`。
- CI 的 lint、测试、构建、生产依赖审计、migration、E2E 和两个 Docker 镜像构建必须全部通过。
- 发布前自动生成数据库备份；备份必须复制到另一台机器或对象存储。
- 不执行 `docker compose down -v`，该命令会删除生产数据库卷。
- `.env.docker` 权限应为 `600`，密钥不得进入 Git、镜像或日志。

Compose 默认限制 API 为 `1 CPU / 768 MB / 256 PID`，前端为 `0.5 CPU / 256 MB / 128 PID`。可通过 `.env.docker` 中的 `API_*_LIMIT` 和 `FRONTEND_*_LIMIT` 按监控数据调整，但不能删除上限后直接发布。

## 版本化发布

```bash
git fetch --tags
git checkout v1.0.0
docker/release.sh v1.0.0
```

版本参数必须是指向当前提交的 Git tag，或当前完整提交号的前缀；脚本会拒绝把错误提交标成已有版本。

发布脚本会拒绝 `latest`、`dev` 和未提交的工作区，并将版本写入：

- 镜像标签，例如 `tangji-api:v1.0.0`；
- OCI 镜像标签 `org.opencontainers.image.version/revision`；
- API 的 `APP_VERSION/BUILD_SHA`；
- 两套前端的 `/build.json`。

发布前可只执行配置闸门，不构建或改动服务：

```bash
RELEASE_VALIDATE_ONLY=true docker/release.sh v1.0.0
```

全栈配置闸门会额外要求微信 Web AppID/Secret、HTTPS 回调、回调与 `APP_ORIGIN` 同源，并确认 `WEB_ORIGIN` 包含该来源；API-only Compose 不要求微信 Web 凭据。

使用镜像仓库时，在 `.env.docker` 设置完整仓库名：

```env
TANGJI_API_IMAGE=ghcr.io/example/tangji-api
TANGJI_FRONTEND_IMAGE=ghcr.io/example/tangji-frontends
```

构建、推送并发布：

```bash
PUSH_IMAGES=true docker/release.sh v1.0.0
```

查看实际运行版本：

```bash
curl --fail http://127.0.0.1:3001/health
curl --fail http://127.0.0.1:5173/build.json
docker image inspect tangji-api:v1.0.0 \
  --format '{{json .Config.Labels}}'
```

## 自动 migration 与旧库 baseline

每次启动依次执行：

1. SQLite `quick_check` 和外键检查。
2. 判断数据库是否已由 Prisma migration 管理。
3. 对旧库执行受控 baseline，或拒绝不明确的数据库。
4. `prisma migrate deploy`。
5. 把实际数据库与完整 migration 历史生成的 shadow 数据库比较，检查 schema drift。该比较以 migration SQL 为准，因此也覆盖 Prisma datamodel 无法表达的 SQLite partial index。

全新数据库和已有 `_prisma_migrations` 的数据库始终保持：

```env
BASELINE_INITIAL_MIGRATION=false
```

只有旧版本通过 `prisma db push` 创建、存在业务表但没有 `_prisma_migrations` 的数据库，才执行一次：

```bash
docker/backup-sqlite.sh
# 将 .env.docker 中 BASELINE_INITIAL_MIGRATION 临时改为 true
docker/release.sh v1.0.0
# 发布成功后立即改回 false
```

启动脚本会把旧库与初始 migration 生成的标准结构做完整差异比较。只有完全一致时才记录 baseline；有缺表、缺列、额外索引或其他漂移时会拒绝启动，必须先人工审查和修复。开关重复设置不会重复写 baseline，但生产配置仍应及时恢复为 `false`。

授权唯一索引升级前，预检还会查找同一用户的多条有效药房绑定。如果发现冲突会在写 migration 前停止，并输出检查 SQL；必须经过业务核对、仅保留一条有效授权、重新备份后再发布。

## 备份

默认备份目录是 `~/tangji-backups`。脚本短暂停止 API 写入，执行 SQLite 完整性和外键检查，生成压缩包、数据库哈希、整包哈希以及版本元数据，随后恢复服务并等待健康检查。

```bash
docker/backup-sqlite.sh

BACKUP_DIR=/srv/tangji-backups docker/backup-sqlite.sh

COMPOSE_FILE=docker-compose.api.yml \
  BACKUP_DIR=/srv/tangji-backups \
  docker/backup-sqlite.sh
```

建议每天至少一次，并设置异地复制和保留策略，例如保留 7 个日备、4 个周备和 12 个按月备份。备份任务失败必须告警；只存在同一 VPS 上的文件不算有效灾备。

每季度在隔离环境完成一次恢复演练，并记录恢复耗时、数据时间点和验收结果。

## 恢复

恢复会替换生产数据库，必须显式确认：

```bash
CONFIRM_RESTORE=YES docker/restore-sqlite.sh \
  ~/tangji-backups/tangji-20260712T010000Z.tar.gz
```

API-only 部署：

```bash
CONFIRM_RESTORE=YES COMPOSE_FILE=docker-compose.api.yml \
  docker/restore-sqlite.sh /srv/tangji-backups/tangji-20260712T010000Z.tar.gz
```

恢复脚本会校验整包哈希、数据库哈希和 SQLite 完整性，并在覆盖前保留临时安全副本。如果恢复后服务不健康，会自动放回原数据库。恢复成功后仍需人工走一遍登录、数据查询、写入和授权验收。

## 应用回滚

先确认旧版本镜像仍在本机；使用仓库时先拉取：

```bash
IMAGE_TAG=v0.9.0 docker compose --env-file .env.docker pull
docker/rollback.sh v0.9.0
```

回滚脚本会先备份当前数据库，只切换到指定的不可变镜像，并等待健康检查。API-only 部署使用：

```bash
COMPOSE_FILE=docker-compose.api.yml docker/rollback.sh v0.9.0
```

应用回滚不会反向执行 migration。若新版本 migration 与旧应用不兼容，应停止写入，使用与旧版本对应的发布前备份恢复数据库，再运行旧镜像。不要凭时间猜测备份版本，先查看压缩包中的 `metadata.env`：

```bash
tar -xOf /srv/tangji-backups/tangji-20260712T010000Z.tar.gz metadata.env
```

## 发布后检查

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=200 tangji-api
curl --fail http://127.0.0.1:3001/health
ss -lnt | grep -E '3001|5173|5174'
```

需要确认健康状态、版本号、监听地址、错误日志和备份文件均正确。发布观察期内保留本次发布前备份和上一版本镜像。
