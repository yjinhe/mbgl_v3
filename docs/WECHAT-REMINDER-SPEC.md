# 小程序测量提醒规格 · 一次性订阅消息版

> 状态：待评审。评审通过后再实现，实现从 master 切 `feat/subscribe-reminder` 分支。
> 范围：`apps/wechat-miniprogram`、`apps/api`、`packages/shared`（仅新增时段文案常量）。不改 `apps/web`、`apps/console`。
> 目标用户是中老年慢病患者，设计判断沿用 `docs/WECHAT-HOME-REDESIGN.md` §1 与 §3 的原则：少操作、大字号、颜色加文字双重编码、关心语气。

## 1. 背景与平台约束（决定了整个方案的形态）

糖迹是个人主体小程序，服务类目「工具 → 健康管理」。微信规则：

- **一次性订阅消息**对所有主体开放。用户点一次授权，开发者可下发一条；授权次数可累积；用户勾选「总是保持以上选择」后，后续调用 `wx.requestSubscribeMessage` 不再弹窗、静默累积。
- **长期订阅消息**只向政务民生、医疗等线下公共服务类目开放，个人主体不可用。服务号模板消息需要企业主体，也不可用。
- `wx.requestSubscribeMessage` 必须在用户点击事件里同步调用，不能在 `wx.showModal` 回调、页面 `onLoad` 或异步请求完成后调用（iOS 会报 `can only be invoked by user TAP gesture`）。
- 一次调用最多 3 个模板 ID。

因此「订阅一次、每天推」做不到。本方案采用 **「每次记录，攒一次」**：用户点「保存记录」时顺手请求授权，攒下明天的提醒额度。坚持记录的人额度自动续上；停止记录的人额度用完后提醒自然停止，这与产品想强化的行为一致。

已选用的公共模板（一次性订阅，健康管理类目）：

| 用途 | 模板 ID | 勾选关键词 |
|---|---|---|
| 血糖测量提醒 | `qvQ6BOZEl8UZjy1i2hVuu4L0-R0zxe8NRA1LmxoWKfY` | 测量时间、测量时段、温馨提示 |
| 血压测量提醒 | `d_a_7U22lRygaMbZjGjj87Z-t-AJfqjRa6UQSQkxdb8` | 提醒时间、备注 |

**待确认**：两个模板各关键词对应的字段 key（形如 `time1`、`thing2`、`phrase3`），在公众平台「订阅消息 → 我的模板 → 详情」的「详细内容」里可见。实现前填入 §7 的配置。

## 2. 目标与非目标

目标：

1. 用户可为血糖、血压分别开启每日提醒，设置提醒时间；血糖可选提醒时段（默认空腹）。
2. 到点且当天还没记录该指标时，发送一条订阅消息；点开直接进入记一笔页并预选指标与时段。
3. 用户每次保存记录时静默攒一次额度；额度为零时首页给出一键续上的入口。
4. 老人不需要理解「额度」概念，界面只说「记录一次，明天就能提醒」。

非目标（本期不做）：

- 血脂、尿酸提醒（化验指标，不需每日测）。
- 用药提醒、关怀消息、家属通知。模板库已有对应模板（逾24小时无血糖记录通知、血糖值异常提醒），数据模型为它们预留扩展位，见 §4。
- 网页端与药房后台的任何改动。

## 3. 用户流程

### 3.1 首次开启

1. 用户在记一笔页第一次成功保存血糖或血压记录后，保存成功弹层的确认按钮文案由「完成返回」改为「完成返回」不变，但弹层关闭后记一笔页顶部出现一条静态横幅（不是弹窗）：「要不要每天这个时候提醒您测血糖？」+ 大按钮「开启提醒」+ 文字链「以后再说」。横幅每个指标只出现一次，用户点「以后再说」后不再出现（本机存储标记）。
2. 点「开启提醒」是一次用户点击：同步调用 `wx.requestSubscribeMessage({ tmplIds: [血糖模板, 血压模板] })`，随后 `PUT /api/app/reminders/{metric}` 保存计划（时间默认取本次记录的测量时间取整到 5 分钟，时段取本次记录时段），并 `POST /api/app/reminders/subscriptions` 上报本次授权结果。
3. 授权弹窗出现时，横幅下方已有一行说明：「弹出提示时请勾选『总是保持以上选择』，以后就不用每次确认」。字号不低于 26rpx。
4. 成功后横幅变为「已开启，每天 07:00 提醒您测空腹血糖。可在『我的 → 测量提醒』修改」。

### 3.2 日常攒额度

- `save()` 点击处理函数开头（发请求之前）同步调用 `wx.requestSubscribeMessage`，模板列表为**用户已开启计划的指标对应模板**；未开启任何计划则不调用，避免无意义弹窗。
- 保存成功后，把授权结果与记录一起上报：`POST /api/app/reminders/subscriptions`，body `{ accepted: ['glucose','bp'] }`（仅包含 `accept` 的模板）。失败静默，不影响保存流程。
- 用户若在弹窗里选了「拒绝」且勾了「总是保持」，后续调用返回 `reject`，不再弹窗；服务端不加额度。首页会在额度为零时给出入口（§3.4）。

### 3.3 收到提醒

- 消息示例（血糖）：「血糖测量提醒 · 测量时间 2026-09-09 07:00 · 测量时段 空腹 · 温馨提示 起床后先测再吃早饭」。
- 消息 `page` 为 `pages/record/index?metric=glucose&period=fasting&from=reminder`。记一笔页 `onLoad` 读取 `metric`/`period`，调用现有 `setRecordMetric`，并在表单初始化后预选时段。
- 到点时若用户当天已记录该指标（`measuredAt` 在当天东八区 00:00 之后），**不发送、不扣额度**。

### 3.4 额度用完

- 首页坚持横幅（`docs/WECHAT-HOME-REDESIGN.md` §2.1）下方，当任一已开启计划的额度为 0 时显示一行：「明天的提醒还没准备好，点一下就好」+ 按钮「准备好」。点击即 `wx.requestSubscribeMessage` + 上报。额度大于 0 时该行不显示。
- 不在任何地方显示具体额度数字，老人不需要这个概念。

### 3.5 设置页「我的 → 测量提醒」

新页面 `pages/reminders/index`，两块大卡片：

```
血糖提醒            [开关]
  提醒时间   07:00  ›   （picker mode=time）
  测量时段   空腹   ›   （picker，选项同记一笔页血糖时段）
血压提醒            [开关]
  提醒时间   07:30  ›
说明：每次保存记录时微信会请您确认一次提醒，勾选「总是保持以上选择」以后就不再询问。
```

- 开关打开是用户点击：先 `requestSubscribeMessage`，再 `PUT` 保存；关闭只 `PUT { enabled: false }`。
- 点击热区、字号遵守 `docs/WECHAT-HOME-REDESIGN.md` §3。
- 「我的」页在「给家人看近7天记录」上方新增单元格「测量提醒」，副文案显示当前状态：「血糖 07:00 · 血压 07:30」或「未开启」。

## 4. 数据模型（Prisma，新增一个 migration）

```prisma
model ReminderPlan {
  id        String   @id @default(cuid())
  userId    String
  metric    String   // 'glucose' | 'bp'
  enabled   Boolean  @default(false)
  time      String   // 'HH:mm'，东八区
  period    String?  // 血糖时段，bp 为 null
  quota     Int      @default(0)   // 剩余可发送条数
  lastSentDay String?             // 'YYYY-MM-DD'，东八区，防止同日重复发送
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, metric])
}

model ReminderLog {
  id          String   @id @default(cuid())
  userId      String
  metric      String
  templateKey String   // 'glucose_reminder' | 'bp_reminder'，为后续关怀/异常模板预留
  scheduledDay String  // 'YYYY-MM-DD'
  sentAt      DateTime @default(now())
  ok          Boolean
  errcode     Int?
  errmsg      String?

  @@index([userId, scheduledDay])
}
```

- `User` 增加反向关系 `reminders ReminderPlan[]`。
- `quota` 上限 30，超过不再累加，防止无限攒。
- 账号注销（`DELETE /me`）时级联删除计划与日志；现有注销流程里补一行删除。
- 后续「关怀消息」「异常提醒」复用 `ReminderLog.templateKey`，额度则各自建 `ReminderPlan` 行（`metric` 可用 `'care'`），本期不实现。

## 5. API（`apps/api/src/routes/app.ts`，均 `requireAuth('app')`）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/app/reminders` | 无 | `{ plans: [{ metric, enabled, time, period, quota }], templates: { glucose: id, bp: id } }` |
| PUT | `/api/app/reminders/:metric` | `{ enabled, time, period? }` | `{ plan }` |
| POST | `/api/app/reminders/subscriptions` | `{ accepted: ('glucose'\|'bp')[] }` | `{ plans }`（对应 quota 各 +1，上限 30） |

校验：`metric ∈ {glucose, bp}`；`time` 匹配 `^([01]\d|2[0-3]):[0-5]\d$`；`period` 仅 glucose 允许且必须在 `glucosePeriods` 内；body 走 `.strict()`。模板 ID 由服务端从配置下发，小程序不硬编码，便于换模板。

## 6. 发送任务（`apps/api/src/services/reminders.ts` + `server.ts` cron）

- cron `*/5 * * * *`，`timezone: 'Asia/Shanghai'`，`noOverlap: true`，与现有回收站清理任务并列。
- 每次执行：
  1. 计算东八区当前 `HH:mm` 与 `YYYY-MM-DD`。
  2. 查询 `enabled = true AND quota > 0 AND lastSentDay != today AND time <= now AND time > now - 10min` 的计划（10 分钟窗口容忍任务延迟；`time` 为字符串比较，`HH:mm` 格式可直接比较）。
  3. 对每条：若用户当天已有该指标记录（`deletedAt: null`，`measuredAt >= 今日 00:00+08:00`），标记 `lastSentDay = today` 但不扣额度、不发送。
  4. 否则调用微信 `subscribeMessage.send`，成功则 `quota -1`、`lastSentDay = today`，写 `ReminderLog(ok=true)`。
  5. 失败按 errcode 处理：`43101`（用户拒绝或额度已用完）→ `quota = 0`；`40003`（openid 无效）→ `enabled = false`；`47003`（字段格式不符）→ 记 error 日志，不改状态；其他 → 记日志，`lastSentDay = today` 避免同日重试刷屏。
- `touser` 取 `user.miniOpenid ?? user.openid`。仅网页注册、无小程序 openid 的用户无法开启提醒，`PUT` 时返回 422 `MINIPROGRAM_REQUIRED`。
- access_token：新增 `apps/api/src/services/wechat-token.ts`，`GET https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=&secret=`，内存缓存到 `expires_in - 300s`；复用现有 `WECHAT_APPID/WECHAT_SECRET`。未配置时 cron 直接跳过并 warn 一次。
- 发送请求体：

```json
{
  "touser": "<miniOpenid>",
  "template_id": "<模板 ID>",
  "page": "pages/record/index?metric=glucose&period=fasting&from=reminder",
  "miniprogram_state": "formal",
  "lang": "zh_CN",
  "data": {
    "<time key>":   { "value": "2026-09-09 07:00" },
    "<thing key>":  { "value": "空腹" },
    "<phrase key>": { "value": "起床后先测再吃早饭" }
  }
}
```

`miniprogram_state` 由环境变量控制，体验版联调时设为 `trial`。

## 7. 文案与配置

血糖「温馨提示」按时段（不超过 20 字，放 `packages/shared/src/constants.ts` 的 `REMINDER_TIPS`）：

| 时段 | 温馨提示 |
|---|---|
| fasting | 起床后先测再吃早饭 |
| post_meal_2h / after_* | 从第一口饭算起两小时 |
| before_lunch / before_dinner | 饭前测，洗净手指 |
| bedtime | 睡前测一次更安心 |
| dawn | 凌晨三点左右测 |
| random | 想起来就测一下 |

血压「备注」固定：「静坐五分钟后再量」。

环境变量（`.env.example`、`.env.docker.example`、`docs/DOCKER-*.md` 同步）：

```
WECHAT_TEMPLATE_GLUCOSE_REMINDER=qvQ6BOZEl8UZjy1i2hVuu4L0-R0zxe8NRA1LmxoWKfY
WECHAT_TEMPLATE_GLUCOSE_FIELDS=time1,thing2,thing3      # 待确认，顺序：测量时间,测量时段,温馨提示
WECHAT_TEMPLATE_BP_REMINDER=d_a_7U22lRygaMbZjGjj87Z-t-AJfqjRa6UQSQkxdb8
WECHAT_TEMPLATE_BP_FIELDS=time1,thing2                  # 待确认，顺序：提醒时间,备注
WECHAT_MINIPROGRAM_STATE=formal                         # trial 用于体验版
```

模板未配置时 `GET /api/app/reminders` 返回 `templates: {}`，小程序据此隐藏全部提醒入口，不影响其他功能。

## 8. 小程序改动清单

| 文件 | 改动 |
|---|---|
| `app.json` | 注册 `pages/reminders/index` |
| `utils/reminders.js`（新） | 封装 `requestSubscribe(templates)`（同步调用 + 结果归一化为 accepted 列表）、`reportSubscriptions`、本机「以后再说」标记 |
| `pages/record/index.js` | `onLoad` 读取 `metric`/`period` 参数；`save()` 开头调用订阅；保存成功后上报；首次成功后显示开启横幅 |
| `pages/record/index.wxml/.wxss` | 开启横幅 |
| `pages/reminders/*`（新） | 设置页 |
| `pages/mine/*` | 「测量提醒」单元格与状态副文案 |
| `pages/home/*` | 额度为零时的「准备好」入口 |
| `test/structure.test.ts` | 页面清单加新页；wxml 事件处理器断言 |
| `test/reminders.test.ts`（新） | 订阅结果归一化、横幅只出现一次、`onLoad` 参数预选 |
| `README.md` | 隐私指引清单不需要新增；上线步骤补「订阅消息模板已选用」 |

## 9. API 测试（vitest）

- `PUT` 校验：非法 metric / time / period 返回 422；bp 带 period 返回 422；无 miniOpenid 返回 422。
- `subscriptions`：quota 累加、上限 30、未开启计划的指标也可累加（用户先攒后开）。
- 发送任务（注入 fake fetch 与固定时间）：
  - 到点、有额度、当天无记录 → 发送一次，quota -1，`lastSentDay` 更新，同一天再执行不重复发。
  - 当天已有记录 → 不发送、不扣额度、`lastSentDay` 更新。
  - errcode 43101 → quota 归零；40003 → enabled=false。
  - 东八区边界：UTC 23:30 执行时 today 应为次日日期（复用 `localDayKey`）。
- 注销账号后计划与日志被删除。

## 10. 上线步骤

1. 公众平台确认两个模板已在「我的模板」，抄录字段 key 填入 `WECHAT_TEMPLATE_*_FIELDS`。
2. `.env.docker` 填模板 ID 与字段；`WECHAT_MINIPROGRAM_STATE=trial` 先在体验版联调，收到消息后改回 `formal`。
3. 执行 migration（`docker/release.sh` 流程已包含）。
4. 小程序提审备注补一句：「新增用户主动订阅的测量提醒，使用一次性订阅消息，不含诊疗建议」。
5. 发布后一周查看 `ReminderLog` 的 errcode 分布，确认 47003 为零（字段格式正确）。

## 11. 待确认

- [ ] 两个模板的字段 key 与格式限制（§1 表格）。
- [ ] 血糖默认时段是否取「本次记录时段」，还是固定「空腹」。建议取本次记录时段：用户什么时候记，就什么时候提醒。
- [ ] 额度上限 30 是否合适。按每天记一次算，相当于攒一个月。
