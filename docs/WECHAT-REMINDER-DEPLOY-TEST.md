# 测量提醒 · 部署与联调手册

> 适用对象：负责部署与验收「小程序测量提醒」功能的执行者（人或 agent）。
> 前置：master 已包含 PR #3（提交 `9340ec2` 及之后）。功能规格见 `docs/WECHAT-REMINDER-SPEC.md`，通用发布流程见 `docs/DOCKER-OPERATIONS.md`。
> 原则：按顺序执行，每一步有明确的「通过标准」；任一步不通过就停下，按 §7 排查，不要跳步。

## 0. 需要准备的信息

| 项目 | 来源 | 本次值 |
|---|---|---|
| 血糖模板 ID | 公众平台「订阅消息 → 我的模板」 | `qvQ6BOZEl8UZjy1i2hVuu4L0-R0zxe8NRA1LmxoWKfY` |
| 血压模板 ID | 同上 | `d_a_7U22lRygaMbZjGjj87Z-t-AJfqjRa6UQSQkxdb8` |
| 血糖模板字段 key | 「我的模板 → 血糖测量提醒 → 详情」的「详细内容」，形如 `{{time1.DATA}}` | **待抄录**，顺序：测量时间、测量时段、温馨提示 |
| 血压模板字段 key | 「我的模板 → 血压测量提醒 → 详情」 | **待抄录**，顺序：提醒时间、备注 |
| 用药模板 ID | 同上 | `8aOOwEcaG0qUgpZwhrR6SevYAp1QkpShbN210qsJjWs` |
| 用药模板字段 key | 「我的模板 → 用药提醒 → 详情」 | **待抄录**，顺序：服药时间、药品、提示说明 |
| 服务器 | 已部署糖迹的宿主机，有 `.env.docker` 与 Docker 权限 | |
| 微信开发者工具 | 能上传体验版，且测试微信号已加为体验成员 | |

字段 key 是本次部署唯一未确认的输入。抄录时只取 `{{` 与 `.DATA}}` 之间的部分，例如 `{{time1.DATA}}` 取 `time1`。

## 1. 打 tag 并准备发布

`docker/release.sh` 只接受指向当前提交的 Git tag。在本地仓库 master 上：

```bash
git checkout master && git pull --ff-only
git tag -a v20260909 -m "Release v20260909: measurement reminders"   # 日期按实际发布日
git push origin v20260909
```

通过标准：`git describe --tags` 输出该 tag。

## 2. 修改服务器上的 `.env.docker`

在现有内容基础上追加或修改以下变量（不要动其他变量）：

```env
# 小程序测量提醒（一次性订阅消息）
WECHAT_TEMPLATE_GLUCOSE_REMINDER=qvQ6BOZEl8UZjy1i2hVuu4L0-R0zxe8NRA1LmxoWKfY
WECHAT_TEMPLATE_GLUCOSE_FIELDS=<key1>,<key2>,<key3>
WECHAT_TEMPLATE_BP_REMINDER=d_a_7U22lRygaMbZjGjj87Z-t-AJfqjRa6UQSQkxdb8
WECHAT_TEMPLATE_BP_FIELDS=<key1>,<key2>
WECHAT_TEMPLATE_MEDICATION_REMINDER=8aOOwEcaG0qUgpZwhrR6SevYAp1QkpShbN210qsJjWs
WECHAT_TEMPLATE_MEDICATION_FIELDS=<key1>,<key2>,<key3>
# 体验版联调阶段用 trial；验收通过后改回 formal
WECHAT_MINIPROGRAM_STATE=trial
```

确认已有的 `WECHAT_APPID` 与 `WECHAT_SECRET` 非空，发送订阅消息依赖它们获取 access_token。

先只跑配置闸门，不构建不重启：

```bash
RELEASE_VALIDATE_ONLY=true docker/release.sh v20260909
```

通过标准：无报错退出。若报 `WECHAT_TEMPLATE_GLUCOSE_FIELDS must have 3 keys` 之类的错误，说明字段数量不对。

## 3. 发布 API

```bash
docker/release.sh v20260909
```

脚本会自动备份 SQLite、执行 migration `20260908000000_measurement_reminders`、做健康检查。

发布后检查：

```bash
docker compose --env-file .env.docker ps
curl --fail http://127.0.0.1:3001/health
docker compose --env-file .env.docker logs --tail=200 tangji-api | grep -i -E 'reminder|migrat'
```

通过标准：

- 两个容器 `healthy`。
- 日志里**没有** `Measurement reminders disabled`。出现这句说明模板 ID 或微信凭据没配上，回到 §2。
- 日志里没有 `Missing env` 或 migration 报错。

## 4. 验证接口已生效

用一个已登录小程序的用户 token 调用（token 可在开发者工具的 Network 面板里从任意请求的 `Authorization` 头复制）：

```bash
curl -s -H "Authorization: Bearer <token>" https://tangji.aiteam.pw/api/app/reminders
```

通过标准：返回 JSON，`templates` 里有 `glucose`、`bp`、`medication` 三个模板 ID，`plans` 为空数组或默认计划。`templates` 为空即模板未配置。

## 5. 上传体验版并联调

小程序端代码无需改配置，模板 ID 由 API 下发。

1. 微信开发者工具打开 `apps/wechat-miniprogram`，确认「不校验合法域名」**未勾选**，上传为体验版。
2. 用体验成员微信号打开体验版，微信登录。
3. **首次开启流程**：记一笔 → 录入一条血糖 → 保存。保存成功后页面顶部应出现横幅「要不要每天这个时候提醒您测血糖？」。点「开启提醒」。
   - 微信弹出订阅授权窗，**勾选「总是保持以上选择」**后点允许。
   - 横幅变为「已开启，每天 HH:mm 提醒您测…」。
4. **设置页**：我的 → 测量提醒。血糖开关应为开，时间为刚才记录时间取整到 5 分钟。把提醒时间改成**当前时间加 6 到 10 分钟**（发送任务每 5 分钟跑一次，窗口 10 分钟）。
5. 等待。到点后应收到微信服务通知「血糖测量提醒」，内容含测量时间、测量时段、温馨提示。
6. 点开消息，应直接进入记一笔页，且指标为血糖、时段为设置的时段。
7. 血压重复第 3 到 6 步。血压不需要选时段。
8. **攒额度流程**：再记一笔任意已开启提醒的指标并保存。此时不应再弹授权窗（因为勾了「总是保持」）。
9. **当天已记录不发**：把提醒时间改到当前时间加 6 分钟，但今天已经记录过该指标，到点后**不应**收到消息。

10. **用药记录**（规格 `docs/WECHAT-MEDICATION-SPEC.md`）：我的 → 我的常用药 → 添加常用药，药名任意填，时间点设为**当前时间加 6 到 10 分钟**，保存。首次保存会弹订阅授权窗，勾「总是保持以上选择」后允许。
11. 回到「我的 → 测量提醒」，第三张卡片「服药提醒」应为开。
12. 到点应收到「用药提醒」消息，药品字段为刚填的药名。点开应进入「我的常用药」页并定位到该时间点。
13. 点该药的「吃了吗？」变为「已吃 ✓」。再添加第二种药，时间点同样设为当前加 6 分钟，到点后消息里应同时出现两个药名（用「、」连接）。
14. **全部打勾不发**：把两种药的时间点都改到当前加 6 分钟，先把两个都打勾，到点后**不应**收到消息。
15. 首页应显示「今天还有 N 次药没记」一行（有未打勾时），全部打勾后消失。
16. 统计 → 周报，最后一张图底部应有「本周服药：计划 N 次，完成 M 次」。

通过标准：第 5、6、7 步收到消息且深链正确；第 8 步无弹窗；第 9 步无消息；第 12、13 步收到用药消息且合并药名；第 14 步无消息；第 15、16 步显示正确。

## 6. 切换到正式并收尾

1. `.env.docker` 中 `WECHAT_MINIPROGRAM_STATE=formal`，然后重启 API（不需要重新构建）：
   ```bash
   docker compose --env-file .env.docker up -d tangji-api
   ```
2. 再次执行 §3 的发布后检查。
3. 小程序提交审核，审核备注在原有说明基础上补充：「新增用户主动订阅的测量提醒与服药提醒，使用一次性订阅消息，每次授权仅发送一条；常用药由用户自行输入，不含药品信息库，不提供用药建议，不含诊疗建议。」
4. 更新 `docs/DOCKER-FULL-DEPLOY.md` §「小程序测量提醒」中「待确认」字样，把实际字段 key 写进去，提交 PR。

## 7. 排查

先看数据库里的发送日志。API 容器内有 Prisma 客户端，可直接查询：

```bash
docker compose --env-file .env.docker exec tangji-api node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  console.log("plans", await p.reminderPlan.findMany());
  console.log("logs", await p.reminderLog.findMany({ orderBy: { sentAt: "desc" }, take: 20 }));
  await p.$disconnect();
})();'
```

若容器内找不到模块，改用 `docker/backup-sqlite.sh` 导出数据库后在宿主机用 `sqlite3` 查询 `ReminderPlan`、`ReminderLog` 两张表。

| 现象 | 看什么 | 原因与处理 |
|---|---|---|
| 保存后没有出现「开启提醒」横幅 | §4 接口的 `templates` | 为空则模板未配置；不为空则检查是否此前点过「以后再说」（清除小程序缓存重试） |
| 点「开启提醒」没弹授权窗 | 开发者工具 Console | 基础库过低或调用不在点击事件内；真机重试，看是否报 `can only be invoked by user TAP gesture` |
| 到点没收到消息，`ReminderLog` 无记录 | API 日志 `Measurement reminder tick` | `due: 0` 表示没有到点计划：检查计划 `enabled`、`quota > 0`、`time` 是否在过去 10 分钟内、`lastSentDay` 是否已是今天 |
| `ReminderLog.errcode = 47003` | 字段 key | key 与模板不符，重新抄录 §0 的字段 key，改 `.env.docker` 后 `docker compose up -d tangji-api` |
| `ReminderLog.errcode = 43101` | 计划 `quota` | 用户拒绝或额度为零。让用户再保存一条记录攒额度，或在首页点「准备好」 |
| `ReminderLog.errcode = 40003` | 用户 `miniOpenid` | openid 不属于该小程序，多为 AppID 配错；计划已被自动停用 |
| `ReminderLog.errcode = 40001/40014/42001` | `WECHAT_SECRET` | access_token 无效；确认 AppSecret 正确且未在公众平台重置 |
| 日志 `access_token` 请求失败 | 服务器出网 | 服务器需能访问 `api.weixin.qq.com` |
| 用药提醒到点没发，`ReminderLog` 有 `errmsg = all_taken` 的行 | `MedicationLog` | 该时间点的药已全部打勾，属正常跳过 |
| 用药提醒同一时间点只发了一次，撤销打勾后也不再发 | `ReminderLog.slot` | 按设计同日同时间点只处理一次 |
| 消息收到但点开不是记一笔页 | `page` 字段 | 体验版与正式版路径一致为 `pages/record/index`；确认体验版是最新上传 |

## 8. 回滚

提醒功能失效不影响记录等核心功能，一般只需在 `.env.docker` 清空两个模板 ID 并重启 API，功能即整体隐藏。若需回滚整个版本：

```bash
docker/rollback.sh v20260908
```

migration 新增的两张表不会被回滚脚本删除，旧版本代码不读这两张表，无影响。

## 9. 验收记录（执行者填写）

| 步骤 | 结果 | 备注 |
|---|---|---|
| §2 配置闸门 | | |
| §3 发布与健康检查 | | |
| §4 接口 templates | | |
| §5.5 收到血糖提醒 | | |
| §5.6 深链预选 | | |
| §5.7 收到血压提醒 | | |
| §5.8 攒额度无弹窗 | | |
| §5.9 已记录不发 | | |
| §5.12 收到用药提醒并定位 | | |
| §5.13 两药合并 | | |
| §5.14 全部打勾不发 | | |
| §5.15 首页未记提示 | | |
| §5.16 周报服药行 | | |
| §6 切回 formal | | |
