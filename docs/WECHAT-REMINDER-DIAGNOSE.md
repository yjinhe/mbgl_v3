# 测量/服药提醒 · 未收到消息自检手册

> 适用对象：负责排查「设置了提醒但没收到微信消息」的执行者（人或 agent）。
> 前置：服务器已按 `docs/WECHAT-REMINDER-DEPLOY-TEST.md` 部署，能在仓库目录执行 `docker compose --env-file .env.docker ...`。
> 原则：按顺序执行，每步先看「判定」，命中即停止并按「处理」操作，然后跳到 §6 填报告。不要跳步猜测。

## 0. 先记录问题现场

填好再开始：

| 项目 | 值 |
|---|---|
| 用户设置的提醒指标 | 血糖 / 血压 / 服药 |
| 设置的提醒时间（东八区） | 例如 09:40 |
| 用户当天在该时间之前是否记录过该指标 | 是 / 否 / 不知道 |
| 授权弹窗是否出现、是否点了「允许」并勾了「总是保持以上选择」 | |
| 期望收到消息的日期 | |

## 1. 确认线上跑的是新版本

```bash
curl -s http://127.0.0.1:3001/health
docker compose --env-file .env.docker ps
```

判定：`/health` 返回的 `version`/`sha` 应对应合并 PR #6 之后的 master（提交 `3dba31f` 或更新），两个容器 `healthy`。

处理：版本旧 → 按 `docs/WECHAT-REMINDER-DEPLOY-TEST.md` §1–§3 重新发布，然后回到本手册 §2。

## 2. 确认定时任务已启用

```bash
docker compose --env-file .env.docker logs --since 24h tangji-api | grep -i -E 'reminder|Missing env' | tail -50
```

判定与处理：

| 日志内容 | 结论 | 处理 |
|---|---|---|
| `Measurement reminders disabled: set WECHAT_APPID/WECHAT_SECRET and WECHAT_TEMPLATE_...` | 模板 ID 或微信凭据未配置，任务根本没排程 | 检查 `.env.docker` 的 `WECHAT_TEMPLATE_GLUCOSE_REMINDER`、`WECHAT_TEMPLATE_BP_REMINDER`、`WECHAT_TEMPLATE_MEDICATION_REMINDER`、`WECHAT_APPID`、`WECHAT_SECRET`；补齐后 `docker compose --env-file .env.docker up -d tangji-api`，重新等一个提醒时间 |
| `WECHAT_TEMPLATE_*_FIELDS must have N keys` 或容器反复重启 | 字段 key 数量不对 | 删除 `.env.docker` 中手填的 `*_FIELDS` 行，使用代码默认值（血糖 `date1,thing2,thing3`，血压 `time4,thing2`，用药 `time1,thing5,thing3`），重启 |
| 24 小时内一条 `reminder` 日志都没有，且没有 disabled 提示 | 容器不是新版本，或日志级别过滤 | 回到 §1；`LOG_LEVEL` 应为 `info` |
| 有 `Measurement reminder tick completed` | 任务在跑 | 记下提醒时间附近那一条的 `due/sent/skipped/failed` 数值，进入 §3 |

补充：任务每 5 分钟跑一次，处理「过去 10 分钟内到点」的计划。提醒时间 09:40 应在 09:40 或 09:45 的 tick 里出现 `due ≥ 1`。

## 3. 读取计划与发送日志

```bash
docker compose --env-file .env.docker exec tangji-api node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const plans = await p.reminderPlan.findMany({ include: { user: { select: { id: true, nickname: true, miniOpenid: true, openid: true, deactivatedAt: true } } } });
  console.log("=== ReminderPlan ===");
  for (const x of plans) console.log(JSON.stringify({ id: x.id, user: x.user.nickname, userId: x.userId, metric: x.metric, enabled: x.enabled, time: x.time, period: x.period, quota: x.quota, lastSentDay: x.lastSentDay, hasMiniOpenid: Boolean(x.user.miniOpenid || (x.user.openid && !/^(web|local):/.test(x.user.openid))), deactivated: Boolean(x.user.deactivatedAt), updatedAt: x.updatedAt }));
  console.log("=== ReminderLog (latest 20) ===");
  for (const x of await p.reminderLog.findMany({ orderBy: { sentAt: "desc" }, take: 20 })) console.log(JSON.stringify(x));
  console.log("=== today records (Asia/Shanghai) ===");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = new Date(day + "T00:00:00+08:00");
  for (const u of plans.map((x) => x.userId).filter((v, i, a) => a.indexOf(v) === i)) {
    const g = await p.glucoseRecord.count({ where: { userId: u, deletedAt: null, measuredAt: { gte: start } } });
    const b = await p.bpRecord.count({ where: { userId: u, deletedAt: null, measuredAt: { gte: start } } });
    console.log(JSON.stringify({ userId: u, day, glucoseToday: g, bpToday: b }));
  }
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });'
```

若提示找不到 `@prisma/client`，先 `docker compose --env-file .env.docker exec tangji-api sh -c "cd /app && pwd"` 确认工作目录，再在 `node -e` 前加 `cd /app &&`。

找到目标用户的那条计划（按 `user` 昵称或 `metric`），按下表判定，**从上到下第一条命中的即为结论**：

| 判定条件 | 结论 | 处理 |
|---|---|---|
| 没有该用户该指标的计划行 | 设置没有保存到服务器 | 让用户重新在「我的 → 测量提醒」打开开关并设置时间；若仍无，查小程序端 `PUT /api/app/reminders/:metric` 的响应（开发者工具 Network） |
| `enabled = false` | 开关是关的，或曾因 errcode 40003 被自动关闭 | 看 ReminderLog 是否有 40003；无则让用户重新打开开关 |
| `time` 与用户设置不一致 | 时间未保存 | 重新设置 |
| `hasMiniOpenid = false` | 账号没有小程序 openid，无法投递 | 该账号只在网页登录过；需在小程序里微信登录后再设置 |
| `deactivated = true` | 账号已注销 | 无需处理 |
| `quota = 0` 且 ReminderLog 无当天记录 | 没有额度：授权时没点允许，或从未授权 | 让用户在首页点「准备好」，或再保存一条记录并在弹窗点「允许」；确认后 `quota` 应 ≥ 1 |
| `lastSentDay = 今天` 且 ReminderLog **无**当天该指标记录 | 用户当天在提醒时间前已记录该指标，任务按设计跳过、不扣额度（`glucoseToday`/`bpToday` 会 ≥ 1） | 这是设计行为，不是故障。验证方法：把提醒时间改到当前时间加 6 到 10 分钟，并保证今天没有该指标的新记录（或删掉今天的测试记录），再等一次 |
| `lastSentDay = 今天` 且 ReminderLog 有当天记录 `ok = true` | 微信已接收消息 | 进入 §4 |
| ReminderLog 有当天记录 `errcode = 47003` | 模板字段 key 或值格式不符 | 确认 `.env.docker` 无手填的 `*_FIELDS`；若有，删除并重启。仍报错则到公众平台「我的模板 → 详情」核对 key，与 `apps/api/src/env.ts` 默认值比对 |
| `errcode = 43101` | 微信侧无额度：用户在弹窗点了「拒绝」，或已勾选「总是拒绝」 | 计划 `quota` 已被归零。让用户到微信「设置 → 小程序 → 糖迹 → 订阅消息」重新允许，再在首页点「准备好」 |
| `errcode = 40003` | openid 不属于当前 AppID | `WECHAT_APPID` 与小程序不一致，或用户是用另一个小程序账号登录的；计划已自动停用 |
| `errcode = 40001 / 40014 / 42001` | access_token 无效 | `WECHAT_SECRET` 错误或已在公众平台重置；修正后重启 |
| `errcode = 47001 / 其他` | 请求体问题或微信侧异常 | 记录 `errmsg` 填入报告 |
| `lastSentDay` 为空、ReminderLog 无记录、§2 的 tick 显示 `due: 0` | 到点时计划不满足条件 | 多为 `quota = 0` 或 `enabled = false`，按上面对应行处理；若都正常，检查服务器时间 `date -u` 与 `TZ`，任务按东八区计算 |

## 4. 微信侧检查（仅当 §3 显示发送成功）

1. 消息在微信「服务通知」会话里，不在小程序内；让用户在微信首页搜「服务通知」。
2. 微信 → 我 → 设置 → 新消息通知 → 小程序通知 → 糖迹，确认允许。
3. 微信 → 设置 → 小程序 → 糖迹 → 订阅消息，确认对应模板未被关闭。
4. `.env.docker` 的 `WECHAT_MINIPROGRAM_STATE`：为 `trial` 时消息指向体验版，非体验成员可能收不到或点开报错；正式用户应为 `formal`，改后 `docker compose --env-file .env.docker up -d tangji-api`。
5. 同一用户同一天同一指标只发一条；已发过就要等明天，或改时间后需 `lastSentDay` 不等于今天（可临时用 §3 的脚本改写：`await p.reminderPlan.update({ where: { id: "<planId>" }, data: { lastSentDay: null } })`）。

## 5. 快速复现一次完整链路

排查修正后，用这个最短路径验证：

1. 确认目标用户今天**没有**该指标的记录（有则删掉，回收站里删除即可）。
2. 「我的 → 测量提醒」把时间设为当前东八区时间加 7 分钟，开关为开。
3. 在首页点「准备好」，弹窗点允许（若不弹说明已勾「总是保持」，也算通过）。
4. 用 §3 脚本确认 `quota ≥ 1`、`enabled = true`、`lastSentDay ≠ 今天`。
5. 等到时间过后 5 到 10 分钟，看 §2 日志出现 `sent: 1`，§3 的 ReminderLog 出现 `ok: true`，微信「服务通知」收到消息。

## 6. 报告模板

```
现场：指标=__ 时间=__ 当天此前是否已记录=__ 授权=__
§1 版本：__
§2 任务日志：__（贴 tick 那一行）
§3 计划：enabled=__ time=__ quota=__ lastSentDay=__ hasMiniOpenid=__
§3 日志：__（贴最近一条，含 errcode/errmsg）
结论（§3 表中命中的行）：__
已执行的处理：__
§5 复现结果：__
```
