# 小程序用药记录与服药提醒规格

> 状态：待评审。评审通过后从 master 切 `feat/medication` 实现。
> 范围：`apps/wechat-miniprogram`、`apps/api`。不改 `apps/web`、`apps/console`。
> 前置：`docs/WECHAT-REMINDER-SPEC.md` 的测量提醒已合并（PR #3），本功能完全复用其订阅、额度与发送机制。

## 1. 资质边界（决定功能范围，实现时不得越界）

糖迹是个人主体，类目「工具 → 健康管理」，官方适用范围是「记录/测试与健康相关内容，如身高、体重、个人身体管理记录等」。医疗服务类目个人主体不可申报，「药品信息展示」需《互联网药品信息服务资格证》。

因此本功能的边界是：**所有内容由用户自己输入，小程序只做记录和提醒，不提供任何来自系统的药品知识。**

| 可以做 | 不能做 |
|---|---|
| 用户自己输入药名、每天几个时间点 | 内置药品库、搜索选药、扫码识别、展示说明书或适应症 |
| 「已服药」打勾、服药完成情况统计 | 剂量、漏服如何补、药物相互作用、任何形式的用药建议 |
| 到点提醒「该吃药了」 | 根据血糖血压数值给出用药相关提示 |
| 周报显示本周服药完成情况 | 「医嘱」「处方」「剂量」等词出现在界面 |

界面固定说明（每个用药页面底部都显示）：「用药请遵医嘱，本功能只帮您记录和提醒。」

订阅消息模板（一次性订阅，健康管理类目）：

| 用途 | 模板 ID | 勾选关键词 |
|---|---|---|
| 用药提醒 | `8aOOwEcaG0qUgpZwhrR6SevYAp1QkpShbN210qsJjWs` | 服药时间、药品、提示说明 |

不勾剂量、用药频次、药方名称、用药建议、风险类别、预警等级、不良反应。字段 key **待确认**（公众平台「我的模板 → 详情」），填入 §7 配置。

## 2. 目标与非目标

目标：

1. 用户维护「我的常用药」清单：药名 + 每天服药的时间点（最多 4 个）。
2. 每天在「今天的药」里按时间点打勾「已服药」，一次点击完成。
3. 到点时，把该时间点的所有药合并成一条提醒；已全部打勾则不发。
4. 周报增加一行「本周服药：计划 N 次，完成 M 次」。
5. 攒额度的动作与用户自然行为绑定：保存记录时、打勾「已服药」时都顺手请求一次授权。

非目标：

- 库存、购药、复诊提醒、家属代打勾。
- 血糖/血压记录的「服药后」标签维持现状，不与本功能联动。

## 3. 用户流程

### 3.1 添加常用药（我的 → 我的常用药）

新页面 `pages/medications/index`，上半部分是「今天的药」，下半部分是「我的常用药」。

添加流程放在同一页面的底部弹层（复用记一笔页的 sheet 样式）：

```
药名        [ 输入框，最多 20 字 ]
每天什么时候吃
  [ 08:00 ]  [ 20:00 ]  [ + 加一个时间 ]     （picker mode=time，最多 4 个，可删）
[ 保存 ]
```

- 药名输入框是普通文本，没有联想、没有候选，避免任何形式的「药品信息展示」。
- 保存后清单里出现一行：药名 + 时间点。每行可编辑、可删除（删除后历史打勾记录保留，用于统计）。
- 最多 8 种药，超出提示「常用药最多 8 种」。
- 添加第一种药并保存时，是一次用户点击：同步调用 `wx.requestSubscribeMessage([用药模板])`，并把 `medication` 提醒开关默认设为开启。弹窗说明同测量提醒：「弹出提示时请勾选『总是保持以上选择』」。

### 3.2 今天的药（打勾）

页面上半部分按时间点分组：

```
08:00   二甲双胍   [ 已吃 ✓ ]      ← 绿色实心 + 文字
        阿卡波糖   [ 吃了吗？ ]     ← 描边 + 文字
20:00   二甲双胍   [ 吃了吗？ ]
```

- 每个按钮不小于 96rpx 高，文字不小于 28rpx，状态用图标加文字双重编码。
- 点「吃了吗？」→ 变为「已吃 ✓」，写入服药记录；再点一次可撤销（误触）。
- 这个点击同时是攒额度的机会：同步调用 `wx.requestSubscribeMessage([用药模板])`，随后上报。用户已勾「总是保持」时无感知。
- 过去的日期不能补打勾，避免记录失真；只能操作今天。
- 没有常用药时，这一区域显示「还没有添加常用药」和一个大按钮「添加常用药」。

### 3.3 收到提醒

- 消息示例：「用药提醒 · 服药时间 2026-09-10 08:00 · 药品 二甲双胍、阿卡波糖 · 提示说明 请按医生要求服用」。
- 「药品」字段限 20 字：按清单顺序用「、」拼接，超出时截断并以「等」结尾。
- `page` 为 `pages/medications/index?slot=08:00&from=reminder`，点开后页面滚动到该时间点分组。
- 到点时，若该时间点的药**已全部打勾**，不发送、不扣额度。

### 3.4 提醒开关（我的 → 测量提醒）

现有设置页增加第三张卡片「服药提醒」，只有一个开关，没有时间设置（时间来自每种药）。副文案：「按常用药里的时间提醒」。开关打开是一次点击，同步请求订阅；关闭只更新计划。

### 3.5 首页

有常用药且今天还有未打勾的时间点时，首页坚持横幅下方显示一行「今天还有 N 次药没记，点一下去看看」，进入用药页。全部打勾后不显示。复用测量提醒「准备好」那一行的样式与位置逻辑；两行都需要显示时，服药行在上。

### 3.6 周报

周报数据增加 `sections.medication = { planned, taken }`（本周计划次数、完成次数，按已有的常用药与打勾记录计算，删除的药按删除前的天数计算）。小程序周报页在指标之后加一行「本周服药：计划 N 次，完成 M 次」。计划为 0 时不显示。

## 4. 数据模型（新增一个 migration）

```prisma
model Medication {
  id         String    @id @default(cuid())
  userId     String
  name       String    // ≤ 20 字，用户输入
  times      String    // JSON 数组，'HH:mm'，1-4 个，升序去重
  archivedAt DateTime? // 删除即归档，保留历史打勾记录
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  logs       MedicationLog[]

  @@index([userId, archivedAt])
}

model MedicationLog {
  id           String     @id @default(cuid())
  userId       String
  medicationId String
  day          String     // 'YYYY-MM-DD'，东八区
  slot         String     // 'HH:mm'
  takenAt      DateTime   @default(now())
  medication   Medication @relation(fields: [medicationId], references: [id], onDelete: Cascade)

  @@unique([medicationId, day, slot])
  @@index([userId, day])
}
```

复用现有表：

- `ReminderPlan` 增加一种 `metric` 取值 `'medication'`：`enabled` 为服药提醒总开关，`quota` 为用药模板的额度，`time` 固定 `'00:00'` 不使用，`period` 为 null，`lastSentDay` 不使用（按时间点去重见下）。
- `ReminderLog` 增加可空列 `slot String?`；用药提醒写入 `templateKey = 'medication_reminder'`、`slot = 'HH:mm'`。同一天同一时间点是否已发送，以 `ReminderLog(userId, templateKey, scheduledDay, slot)` 是否存在为准（无论成功失败，避免同日重试刷屏）。

`User` 增加 `medications Medication[]`。注销账号时删除 `Medication`、`MedicationLog`。

## 5. API（`requireAuth('app')`，body `.strict()`）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/app/medications` | 无 | `{ medications: [{ id, name, times }], today: { day, slots: [{ time, items: [{ medicationId, name, taken }] }] }, reminder: { enabled, quota }, template?: id }` |
| POST | `/api/app/medications` | `{ name, times }` | `{ medication }`；超过 8 种返回 422 `MEDICATION_LIMIT` |
| PATCH | `/api/app/medications/:id` | `{ name?, times? }` | `{ medication }` |
| DELETE | `/api/app/medications/:id` | 无 | 204，归档 |
| POST | `/api/app/medications/checkins` | `{ day, slot, medicationId, taken: boolean }` | `{ today }`；`day` 必须是东八区今天，否则 422 |
| PUT | `/api/app/reminders/medication` | `{ enabled }` | `{ plan }`（复用现有路由，metric 扩展为 `glucose \| bp \| medication`；medication 不接受 time/period） |
| POST | `/api/app/reminders/subscriptions` | `{ accepted: [... 'medication'] }` | 复用，`accepted` 枚举增加 `medication` |
| GET | `/api/app/report/weekly` | 复用 | `sections.medication` 见 §3.6 |

校验：`name` trim 后 1–20 字；`times` 1–4 个、`^([01]\d|2[0-3]):[0-5]\d$`、去重升序存储；`slot` 必须属于该药的 `times`。

## 6. 发送任务（扩展 `runReminderTick`）

在现有 tick 中增加第二段处理，共用 access_token 与 10 分钟窗口：

1. 查 `ReminderPlan(metric='medication', enabled=true, quota>0)` 且用户未注销、未归档药 ≥ 1。
2. 对每个用户，收集所有未归档药的 `times`，取落在窗口内的时间点 `slot`。
3. 对每个 `slot`：若 `ReminderLog` 已有当天该 slot 记录则跳过；若该 slot 的所有药都已在 `MedicationLog` 打勾则写一条 `ok=true, errmsg='all_taken'` 的日志占位并跳过，不扣额度；否则发送。
4. 发送成功 `quota -1`；errcode 处理与测量提醒一致（43101 → quota 0，40003 → enabled false，47003 → 记 error）。
5. 消息内容：`[服药时间 'YYYY-MM-DD HH:mm', 药品 names(≤20), 提示说明 '请按医生要求服用']`，`page = pages/medications/index?slot=HH:mm&from=reminder`。

额度说明：一个用户每天有几个时间点就需要几条额度。攒额度的入口有三个：保存记录、打勾「已服药」、首页「准备好」。用户每次打勾都攒一条，正常使用下额度自平衡；不够时首页那一行会提示。

## 7. 配置与文案

```
WECHAT_TEMPLATE_MEDICATION_REMINDER=8aOOwEcaG0qUgpZwhrR6SevYAp1QkpShbN210qsJjWs
WECHAT_TEMPLATE_MEDICATION_FIELDS=time1,thing2,thing3   # 待确认，顺序：服药时间,药品,提示说明
```

`env.ts` 的 `reminderTemplates` 增加 `medication`（3 个字段）。`GET /api/app/reminders` 的 `templates` 增加 `medication`；未配置时小程序隐藏服药提醒开关，但常用药清单和打勾功能仍可用（记录不依赖提醒）。

固定文案：

- 提示说明：「请按医生要求服用」
- 页脚：「用药请遵医嘱，本功能只帮您记录和提醒。」
- 打勾按钮：「吃了吗？」/「已吃 ✓」
- 全部不得出现「剂量」「处方」「医嘱建议」「用法用量」。

## 8. 小程序改动清单

| 文件 | 改动 |
|---|---|
| `app.json` | 注册 `pages/medications/index` |
| `utils/medications.js`（新） | `loadMedications`、`saveMedication`、`removeMedication`、`checkin`、`slotsForToday`、`pendingCount`、药名与时间校验 |
| `utils/reminders.js` | `REMINDER_METRICS` 增加 `medication`；`metricName` 增加「服药」；`planSummary` 处理无时间的计划 |
| `pages/medications/*`（新） | 今天的药 + 常用药清单 + 添加/编辑弹层；`onLoad(options.slot)` 定位 |
| `pages/reminders/*` | 第三张卡片「服药提醒」，仅开关 |
| `pages/mine/*` | 「我的常用药」单元格，副文案「N 种」或「未添加」，放在「测量提醒」下方 |
| `pages/home/*` | 「今天还有 N 次药没记」一行 |
| `pages/record/index.js` | `requestReminderQuota` 的模板列表加入 medication（已开启时），最多 3 个正好用满 |
| `pages/weekly-report/*`、`utils/weekly-report.js` | 服药一行 |
| `test/structure.test.ts`、`test/medications.test.ts`（新） | 页面注册、事件处理器、文案禁用词断言（`剂量`、`处方`）、打勾切换、slot 定位、药品字段 20 字截断 |

## 9. API 测试

- CRUD：8 种上限、名称长度、times 去重排序与格式、归档后不出现在列表但历史日志保留。
- checkins：只允许今天；重复打勾幂等；`taken:false` 删除记录；slot 不属于该药返回 422。
- tick：窗口内多个药同一 slot 只发一条、药名拼接与 20 字截断；全部已打勾不发不扣额度；部分打勾仍发；同日同 slot 不重复；额度扣减；errcode 分支；已归档药不参与。
- 周报 `sections.medication` 的计划与完成计数，含本周中途添加/删除的药。
- 注销清理。

## 10. 上线步骤

1. 公众平台抄录用药模板字段 key，填入 `.env.docker`。
2. 提审备注补充：「新增用户自行记录常用药与服药情况的功能，药名由用户输入，不含药品信息库，不提供用药建议；服药提醒为用户主动订阅的一次性订阅消息。」
3. 联调步骤参照 `docs/WECHAT-REMINDER-DEPLOY-TEST.md`，增加：添加一种药、打勾、到点收到合并提醒、全部打勾后不再提醒。

## 11. 待确认

- [ ] 用药模板字段 key。
- [ ] 每种药最多 4 个时间点、最多 8 种药，是否够用。
- [ ] 周报「本周服药」是否需要按天展示，本期只做总次数。
