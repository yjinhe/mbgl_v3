# 糖迹 V3

慢病健康记录产品：手机 Web 为用户主入口，配套药房后台、Fastify + Prisma API；微信小程序保留为次要渠道。

## 一键启动

```bash
pnpm install
pnpm --filter @tangji/api prisma:generate
DATABASE_URL="file:./dev.db" pnpm --filter @tangji/api prisma:migrate:deploy
DATABASE_URL="file:./dev.db" pnpm --filter @tangji/api seed
pnpm dev
```

生产环境只执行 migration，不会自动 seed。演示 seed 会清空现有业务数据，只能用于一次性开发数据库。

## 演示账号

- 手机 Web：`demo / Demo@1234567`
- C 端 mock 微信登录：开发环境也可点击「微信一键登录」
- 药房 A staff：`kn_li / Kn@123456`
- 药房 A owner：`kangning / Kn@123456`
- 药房 B owner：`baixingyuan / Bxy@123456`
- 平台 admin：`admin / Admin@123456`
- 演示邀请码：`KN23DEMO`

## 微信小程序端（次要渠道）

原生小程序工程保留在 `apps/wechat-miniprogram`，目前以兼容和维护为主，新用户优先使用手机 Web。未配置小程序 AppID/Secret 不会影响 Web 注册登录和正常发布。详细说明见 `apps/wechat-miniprogram/README.md`。

## Docker 部署

- 只部署 API：见 `docs/DOCKER-API-DEPLOY.md`
- 统一部署 API + C 端 Web + 药房后台：见 `docs/DOCKER-FULL-DEPLOY.md`
- 版本发布、旧库 migration、备份、恢复与回滚：见 `docs/DOCKER-OPERATIONS.md`

生产发布统一使用不可变镜像标签，例如 `docker/release.sh v1.0.0`。脚本会在更新前备份 SQLite，并在 migration 和服务健康检查全部通过后完成发布；不要使用 `latest` 或执行 `docker compose down -v`。

## 3 分钟演示路径

1. 打开 C 端，登录，查看首页四指标。
2. 点击中央水滴按钮，录入血压 `185/115`，查看安全提醒。
3. 打开药房后台，登录 `kn_li`，在预警中心标记跟进。
4. 在 C 端「统计」生成健康周报，打开导出数据 ActionSheet（单 CSV / 全部 ZIP）。
5. 在 C 端「我的」绑定/解绑服务药房，后台刷新后客户详情会 403。

## Open Decisions

- C/B 图表先用轻量 DOM 趋势呈现；`packages/shared/chart-options.ts` 已改为 token 化 ECharts option 构造器，后续可替换为真实 ECharts 渲染。
- seed 已覆盖演示链路、10 客户和预警点，89 天逐参数完整生成仍需继续扩展。

## Known Issues

- 样式已机械提取并复用原型类名，但血糖四页+录入弹层尚未建立自动像素 diff 基线。
- E2E 覆盖登录、录入弹层、单位切换、周报/导出/回收站、后台登录、药房资料和预警跟进；仍可继续加强为 SPEC §13.4 的逐字断言版本。
