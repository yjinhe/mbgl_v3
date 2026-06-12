# 糖迹 V2

慢病健康记录产品：C 端移动 Web、药房后台、Fastify + Prisma API。

## 一键启动

```bash
pnpm install
pnpm --filter @tangji/api prisma:generate
DATABASE_URL="file:./dev.db" pnpm --filter @tangji/api exec prisma db push --skip-generate
DATABASE_URL="file:./dev.db" pnpm --filter @tangji/api seed
pnpm dev
```

当前环境里 Prisma `db push` 的 schema engine 可能返回 `Schema engine error: undefined`，API 集成测试已用 raw SQL 初始化测试库绕过；开发库如遇到同样问题，请先记录为本机 Prisma engine 问题。

## 演示账号

- C 端 mock 登录：点击「微信一键登录」
- 药房 A staff：`kn_li / Kn@123456`
- 药房 A owner：`kangning / Kn@123456`
- 药房 B owner：`baixingyuan / Bxy@123456`
- 平台 admin：`admin / Admin@123456`
- 演示邀请码：`KN23DEMO`

## 3 分钟演示路径

1. 打开 C 端，登录，查看首页四指标。
2. 点击中央水滴按钮，录入血压 `185/115`，查看安全提醒。
3. 打开药房后台，登录 `kn_li`，在预警中心标记跟进。
4. 在 C 端「我的」绑定/解绑服务药房，后台刷新后客户详情会 403。

## Open Decisions

- P2 测试库使用 raw SQL 初始化，因为当前本机 Prisma schema engine 在 `db push` 阶段崩溃，但 `prisma validate/generate` 正常。
- C/B 图表先用轻量 DOM 趋势呈现，shared ECharts option 构造器已提供，后续可替换为真实 ECharts 渲染。
- seed 已覆盖演示链路、10 客户和预警点，89 天逐参数完整生成仍需继续扩展。

## Known Issues

- 样式已机械提取并复用原型类名，但截图差异尚未完全清零。
- E2E 当前 5 条 smoke 通过，覆盖登录、录入弹层、单位切换、后台登录和预警跟进；仍需加强为 SPEC §13.4 的逐字断言版本。
