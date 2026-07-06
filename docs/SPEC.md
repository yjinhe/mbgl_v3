# 「糖迹」V3 · 多指标健康记录 + 药房客户管理后台 · 全栈开发任务规格书(Codex 执行版)

你是一名资深全栈工程师。请在一个新仓库中从零实现「糖迹」V3 —— 一款 **慢病健康记录产品**:

- **C 端(移动 Web)**:面向患者,记录并管理 **血糖、血压、血脂、尿酸** 四类指标;
- **B 端(桌面 Web 后台)**:面向 **药房**,各药房通过邀请码发展自己的客户,经客户**明确授权**后查看其健康记录、接收异常预警、做跟进管理;
- **后端**:承载全部业务规则、统计聚合、多租户数据隔离与权限控制。

**本文为唯一有效规格(取代 V1 全文)。配套文件 `design/prototype.html` 是一份血糖单指标的高保真交互原型:它定义了整个产品的设计体系(令牌、组件、外壳、动效)与 C 端血糖部分的像素级基准。开工前必须先在浏览器完整体验该原型并通读其内联 CSS/JS。优先级:本规格书 > 原型 > 自行决策(记录到 README「Open Decisions」)。**

---

## 0. 任务总览与交付物

| 交付物 | 说明 |
|---|---|
| `apps/web` | C 端移动 Web。血糖部分 UI/交互 **100% 还原原型**;血压/血脂/尿酸按本文规格、用同一设计体系扩展 |
| `apps/console` | B 端后台(药房工作台 + 平台管理员视图,同一 React 应用按角色渲染) |
| `apps/api` | RESTful 后端:`/api/app/*`(C 端)、`/api/pharmacy/*`(药房)、`/api/admin/*`(平台) |
| `packages/shared` | 前后端共享纯函数:四类指标的换算/推断/状态判定/统计公式 + ECharts option 构造器 + TS 类型 |
| 测试 | 算法单测、API 集成测试(**含权限矩阵**)、5 条 Playwright E2E |
| 文档 | `README.md`(一键启动+演示账号表)、`docs/SELF-CHECK.md`(§13 验收清单自检结果) |

成功标准:`pnpm install && pnpm dev` 同时拉起 api/web/console;种子数据齐备;用演示账号能走通「药房生成邀请码 → 患者绑定授权 → 患者录入异常血压 → 药房预警中心看到并标记跟进」完整链路;`pnpm test` 全绿。

---

## 1. 硬性约束(不可妥协,违反任意一条视为任务失败)

1. **设计体系与血糖像素基准** = `design/prototype.html`。其 `<style>` 整体移植为共享样式基底;C 端血糖相关页面(首页血糖 hero、血糖录入键盘、血糖历史/统计/周报形态)逐像素一致。新增指标与 B 端复用同一令牌与组件体系。
2. **全仓库禁止 Tailwind / Bootstrap / Ant Design / MUI 等任何 CSS 框架与 UI 组件库**(B 端也不例外,表格表单手写)。图表唯一例外 ECharts。
3. **§11 文案总表逐字使用**。涉医文案为合规红线。
4. **不输出任何诊断结论与用药建议**:状态标签只允许「达标/正常/偏低/偏高/显著偏高/边缘升高/升高」这类描述性词汇,**禁止出现"高血压 X 级""糖尿病""高脂血症""痛风"等疾病/分级诊断名词**;所有统计与 B 端客户页带免责脚注。
5. **数据隔离红线**:药房只能访问「当前处于已授权绑定状态」的本药房客户数据;任何跨药房访问、解绑后访问一律 403,服务层强制校验(不得只靠前端隐藏)。客户绑定必须经过**显式授权确认**,且可随时解绑、解绑即时生效(含历史数据)。
6. 单位:血糖库存 mmol/L(×18 换算 mg/dL,用户可切换);**血压固定 mmHg、血脂固定 mmol/L、尿酸固定 μmol/L,不参与单位切换**。
7. 不引入 §2 之外的运行时依赖;后端校验为权威;不用 localStorage 存健康数据(仅 token 与单位偏好)。

---

## 2. 技术栈(锁定)

| 层 | 选型 |
|---|---|
| 仓库 | pnpm workspaces monorepo,pnpm ≥9 |
| 前端 ×2 | Vite 5 + React 18 + TypeScript + react-router-dom ^6 + Zustand ^4 |
| 图表 | echarts ^5.4(按需引入);长图 html2canvas ^1.4;二维码 qrcode ^1 |
| 后端 | Node 20 + Fastify ^4 + TypeScript + zod ^3 |
| ORM/DB | Prisma ^5 + SQLite(默认)/PostgreSQL(`DATABASE_URL` 切换) |
| 鉴权 | `@fastify/jwt`(JWT 含 `aud: app|pharmacy|admin` 与角色);密码 bcryptjs ^2 |
| 打包导出 | archiver ^6(全量导出 zip) |
| 定时 | node-cron ^3;测试 Vitest + supertest + Playwright |

`.env.example`:`DATABASE_URL`、`JWT_SECRET`、`WECHAT_MOCK=true`、`WECHAT_APPID/SECRET`、`TZ=Asia/Shanghai`、`PORT=3001`、`VITE_API_BASE`、`ADMIN_INIT_PASSWORD`。

---

## 3. 仓库结构

```
tangji/
├─ design/prototype.html
├─ apps/
│  ├─ web/                      # C 端(手机壳内)
│  │  └─ src/{styles,shell,pages,features/record-sheet,components,store,api}
│  ├─ console/                  # B 端(桌面布局:侧栏+内容区)
│  │  └─ src/{styles,layout,pages/{dashboard,customers,alerts,invites,staff,settings,admin},components,store,api}
│  └─ api/
│     └─ {prisma/{schema.prisma,seed.ts}, src/{routes/{app,pharmacy,admin},services,plugins/auth,jobs}, test}
└─ packages/shared/
   └─ src/{constants.ts, glucose.ts, bp.ts, lipid.ts, uric.ts, stats.ts, chart-options.ts, types.ts}
```

`chart-options.ts`:所有 ECharts option 以纯函数构造(输入数据+单位+目标 → option 对象),**C 端与 B 端客户详情复用同一构造器**,保证两端图表完全一致。

---

## 4. 设计系统

### 4.1 设计令牌
原型 `:root` 全量令牌(`--ink/--paper/--brand:#0E7E6B/--ok:#19A77E/--hi:#E8833A/--danger:#D6453D/--lo:#4A7DDB/--desk:#0F2420` 等,见原型,逐字移植,一个色值不改)。系统字体栈,数字 `tabular-nums`。

### 4.2 通用语义五态(四类指标共用同一套颜色语义)

| key | 通用含义 | 颜色 |
|---|---|---|
| `dlow` | 显著偏低/低风险 | `--danger` |
| `lo` | 偏低 | `--lo` |
| `ok` | 达标/正常/合适 | `--ok` |
| `hi` | 偏高/边缘升高 | `--hi` |
| `dhigh` | 显著偏高/升高 | `--danger` |

各指标的判定阈值见 §6;凡出现测量数值处(大数字、列表、图表点、B 端状态点)颜色一律由五态决定。

### 4.3 指标识别色(仅用于图标底、卡片眉、tab 强调,**不得**用于数值着色)

| 指标 | 主色 | soft 底 |
|---|---|---|
| 血糖 glucose | `#0E7E6B`(=brand) | `#E2F1EC` |
| 血压 bp | `#3E63C9` | `#E8EDFA` |
| 血脂 lipid | `#C77B33` | `#FAF0E3` |
| 尿酸 uric | `#7A5BBF` | `#F0EAFA` |

以 CSS 变量 `--m-glucose/--m-bp/--m-lipid/--m-uric`(及 `-soft`)追加到令牌。每个指标配一枚 20×20 线性 SVG 图标:水滴(血糖,沿用原型)/ 心跳波形(血压)/ 三层液滴(血脂)/ 六边形分子(尿酸),笔触 1.8、圆角端点,风格与原型 tab 图标一致。

### 4.4 组件与外壳
卡片/pill/chip/seg/btn/switch/stepper/toast/modal/action-sheet/手机框架/假状态栏/微信胶囊/TabBar(含中央水滴按钮)全部沿用原型规格与动效参数(sheet `.28s cubic-bezier(.32,.72,.25,1)`、页面 `.22s`、modal `.2s`、toast 2.1s、`prefers-reduced-motion` 关闭动画、`:focus-visible` 品牌描边)。B 端布局规格见 §7.1。

---

## 5. C 端规格(`apps/web`)

### 5.0 路由与登录
路由:`/login`、`/`、`/history`、`/stats`、`/mine`;子页(右滑入):`/report`、`/recycle-bin`、`/bind-pharmacy`。登录页:深绿背景卡片、水滴 logo、「糖迹」、slogan「5 秒记一次健康数据」、`btn.primary`「微信一键登录」(`WECHAT_MOCK=true` 直发 token)。

### 5.1 首页 = 四指标总览
1. 问候区(问候语/日期/「今天已记 n 笔」/🔥 streak 徽章)— 同原型;**streak 定义更新:当天任意指标有 ≥1 条记录即算**。
2. **血糖 hero 卡:与原型逐像素一致**(深绿渐变、54px 大数字、状态 pill、2–20 量程 gauge、目标带、五态色圆点)。
3. **血压卡**(白卡):眉行「(心跳图标·靛蓝 soft 底) 血压 · 最近一次 {时段名}」+ 右侧时间;主行 27px `{SBP}/{DBP}` + 小字 `mmHg` + (有则)`♥ {pulse}`;状态 pill;副行灰字「家庭自测参考 <135/85」。
4. **血脂卡**(白卡):眉行「(血脂图标) 血脂 · {M月D日} 化验」+ 整体状态 pill;主体 2×2 小网格:`TC / TG / LDL-C / HDL-C` 各显示「缩写 + 数值」,数值着各自五态色;无记录项显示「—」。
5. **尿酸卡**(白卡):眉行「(尿酸图标) 尿酸 · 最近一次」;主行 27px 数值 + `μmol/L` + 状态 pill;副行「参考上限 <{420|360}(按性别)」。
6. 各指标卡整卡可点 → 跳统计页对应指标 tab;某指标从未记录时,卡内显示空态一行「还没有{指标}记录 · 点下方按钮记一笔」。
7. 卡片排序固定:血糖 → 血压 → 血脂 → 尿酸。数据来自一次 `GET /api/app/overview`。

### 5.2 录入弹层(中央水滴按钮唤起)
标题行下新增 **指标 seg(4 项:血糖|血压|血脂|尿酸)**,默认选中本次会话上一次使用的指标(首次=血糖)。时间行(datetime-local)、备注(≤50 字)与保存流程骨架四类共用;键盘区与中部字段按指标切换:

- **血糖面板:与原型 100% 一致**(64px 实时变色大数字+光标、9 时段九宫格+「已按当前时间推荐」、6 个情景标签、3×4 键盘+纵跨 3 行竖排保存键、mmol/mgdl 输入位数规则、§6.1 实时状态文案)。
- **血压面板**:大数字区改为三字段横排 `收缩压 / 舒张压 / 脉搏(选填)`,激活字段底部 2px 品牌色下划线 + 同款闪烁光标;数值颜色 = 当前已填完整组合的整体五态(未填齐时灰)。键盘同款 3×4,「·」键替换为「下一项」(自动聚焦顺序 SBP→DBP→pulse;SBP/DBP 满 3 位自动跳下一项);时段 chips 4 个:晨起/白天/晚间/夜间(按 §6.2 自动推断,同「已按当前时间推荐」逻辑);情景标签:服药前/服药后/运动后/情绪波动。实时状态行文案见 §11。
- **血脂面板**:四行输入 `总胆固醇 TC / 甘油三酯 TG / 低密度 LDL-C / 高密度 HDL-C`(单位 mmol/L,小数 ≤2 位,至少填一项才可保存),每行右端实时显示该项五态小圆点;附「空腹采血」switch(默认开)。无时段、无标签。
- **尿酸面板**:64px 大数字(整数,μmol/L)实时变色 + 状态行;「空腹采血」switch;无时段、无标签。
- 保存:调对应 `POST /api/app/records/{metric}` → toast(§11)→ 刷新 → 响应 `safetyAlert ≠ null` 时 340ms 后弹对应安全 modal(§11 M1/M2/M8/M9/M10)。编辑模式各面板同构预填。

### 5.3 历史页
顶部一级 **指标 seg**(血糖|血压|血脂|尿酸,默认血糖,不做混排);血糖选中时,其下保留原型的 9 时段 chips 二级筛选。按天分组与 day 头规则同原型(血脂/尿酸 day 头不显示日均,只显示「n 次」)。记录卡复用原型结构(左 4px 五态色条):
- 血糖:同原型;
- 血压:第一行「{时段} HH:mm + pill」,右侧 21px `{SBP}/{DBP}`(五态色)+ 小字 `mmHg · ♥{pulse}`;
- 血脂:第一行「化验 HH:mm + 整体 pill」,第二行四项缩写值(各自五态色),右侧不放大数字;
- 尿酸:右侧 21px 数值 + `μmol/L`。
点击 → ActionSheet 编辑/删除(M5 确认,软删入回收站)— 四类指标通用;回收站子页混合展示四类(行首加指标小图标)。

### 5.4 统计页
顶部一级 **指标 seg**;其下内容按指标:
- **血糖**:与原型完全一致(7/30/90 seg、2×2 指标卡、TIR 三段条、明细/汇总趋势、时段散点、生成报告按钮、F1 脚注)。
- **血压**(7/30/90 seg):2×2 指标卡 = 平均收缩压 / 平均舒张压 / 达标率(<135/85)/ 平均脉搏;**双折线趋势图**(SBP 靛蓝实线、DBP 靛蓝 60% 细线,135 与 85 两条灰虚线参考线,点色=该条五态);**时段分布散点**(x=晨起/白天/晚间/夜间)。
- **血脂**(无 range seg,展示全部化验点):最近一次化验卡(四项数值+各自 pill+参考范围小字);**四项折线图**(legend 可点击显隐,TC/TG/LDL/HDL 四色取指标识别色系深浅,y 轴 mmol/L,LDL 3.4 参考虚线);化验记录表(日期/四项/整体状态)。
- **尿酸**(7/30/90 但数据稀疏时自动显示全部):指标卡 = 最近一次 / 平均 / 达标率;折线 + 性别阈值虚线({420|360})+ 540 红色虚线。
- 各指标页尾均带 F1 免责脚注。数据各来自 `GET /api/app/stats?metric=&range=`。

### 5.5 健康周报(`/report`)
入口:血糖统计页按钮文案改为「生成健康周报」。报告卡(`#reportCard`,深绿头部改副题「近 7 天健康报告」):**按"近 7 天内有数据的指标"动态分节**——血糖节(四宫格+趋势+分时段表,同原型)、血压节(均值/达标率 + 双线图)、血脂节(最近化验四项表)、尿酸节(最近值+均值)。页脚 F2(增加各指标参考口径一句话)。按钮:保存长图(html2canvas)/ 导出数据(ActionSheet 选指标:血糖/血压/血脂/尿酸 → 单 CSV;全部 → zip)。

### 5.6 我的页
1. 头部:头像/昵称/「已记录 n 条 · 覆盖 d 天」(四指标合计)。
2. **健康档案**组:性别 seg(男|女,未设置时尿酸按 420 口径并在尿酸卡提示「设置性别后参考值更准确」,切换 toast T12)/ 控糖目标三 stepper(同原型,仅作用血糖)/ 血糖单位 seg(注明「仅血糖支持单位切换」,F9)。
3. **服务药房**组(本期新增,核心):
   - 未绑定:cell「绑定服务药房」副文「输入药房邀请码,获得用药与健康管理服务」→ 进入 `/bind-pharmacy` 子页:8 位邀请码输入框(自动大写)+「查询」→ 显示药房卡片(名称/门店地址/邀请店员)→ `btn.primary`「同意授权并绑定」点击先弹 **M6 授权确认 modal(合规关键,文案逐字)** → 确认 → `POST /api/app/pharmacy/bind` → toast T13 → 返回。
   - 已绑定:cell 显示药房名 + 副文「{绑定日期} 起 · 该药房可查看你的健康记录」+ 右侧「解绑」红字 → **M7 确认** → `DELETE /api/app/pharmacy/bind` → toast T14。
4. 数据与隐私组:导出数据(同 5.5 的指标选择)/ 回收站 / 注销(M3,文案 n 改为四指标合计)。
5. 关于组与页尾 F3 同原型。

---

## 6. 各指标业务规则(权威定义,全部实现在 `packages/shared`,前后端共用)

### 6.1 血糖(口径与 prototype.html 完全一致)
- 存储 mmol/L `Decimal(4,2)`;换算系数 18;展示 mmol 1 位小数 / mgdl 整数。
- 合法域 [1.1, 33.3] mmol/L(= 20–600 mg/dL)。
- 9 时段自动推断表(h=hours+minutes/60):[5,9)空腹 / [9,11)早餐后 / [11,12)午餐前 / [12,15)午餐后 / [15,17)随机 / [17,18.5)晚餐前 / [18.5,21.5)晚餐后 / [21.5,24)睡前 / [0,5)凌晨;fast 型={空腹,午餐前,晚餐前,睡前,凌晨},post 型其余。
- 五态(比较前四舍五入 2 位小数):v<3.9→dlow「低血糖」;v>16.7→dhigh「显著偏高」;v>时段上限→hi「偏高」;v<fastingLow→lo「偏低」;否则 ok「达标」。
- 个人目标默认 {4.4, 7.0, 10.0},可调范围 [3.0,6.0]/[5.0,10.0]/[6.0,15.0] 步进 0.1 且 low<fastingHigh≤postMealHigh。
- TIR 固定带 3.9–10.0;CV=sd/avg×100(阈值 36%);GMI(%)=3.31+0.02392×(avg×18),展示必伴「仅供参考」;安全提醒:<3.9 → low,>16.7 → high。
- daily_summary 预聚合:记录的创建/更新/软删/恢复在**同一事务内**按当天全部有效记录重算并 upsert 当日汇总;趋势序列 range≤7 查明细表、range=30/90 查 daily_summary(响应 `series.mode` 区分);cron 每日 03:00 全量重算最近 90 天兜底。

### 6.2 血压
- 字段:sbp、dbp 必填(整数 mmHg),pulse 选填;合法域 sbp∈[50,300]、dbp∈[30,200]、sbp>dbp、pulse∈[30,220]。
- 时段推断:[4,10) 晨起 morning / [10,17) 白天 daytime / [17,22) 晚间 evening / [22,24)∪[0,4) 夜间 night。
- 五态(家庭自测口径,SBP/DBP 各判后取更严重档):sbp<90 或 dbp<60 → dlow「偏低」;sbp<135 且 dbp<85 → ok「正常」;sbp<160 且 dbp<100 → hi「偏高」;否则 → dhigh「明显偏高」。**不得使用"高血压 X 级"表述。**
- 达标率口径 = ok 占比;安全提醒:sbp≥180 或 dbp≥110 → `high`(M8);sbp<90 或 dbp<60 → `low`(M9)。
- 数据量小(≤2 条/日),**不做预聚合**,统计直查明细(README 记录此取舍)。

### 6.3 血脂
- 字段:tc、tg、ldl、hdl 均选填 `Decimal(4,2)` mmol/L,**至少一项非空**;fasting 布尔(默认 true);合法域各项 [0.1, 30]。
- 单项五态:TC <5.2 ok「合适」/ 5.2–6.19 hi「边缘升高」/ ≥6.2 dhigh「升高」;TG <1.7 / 1.7–2.29 / ≥2.3 同上;LDL <3.4 / 3.4–4.09 / ≥4.1 同上;HDL ≥1.0 ok「合适」、<1.0 hi「偏低」。整体状态 = 各非空项中最严重档(dhigh>hi>ok)。
- 无时段、无安全弹窗;参考范围为一般人群化验单口径,页面以小字标注(F1 覆盖)。

### 6.4 尿酸
- 字段:value 整数 μmol/L;合法域 [50, 1500];fasting 布尔默认 true。
- 阈值按用户性别:male/未设置 420,female 360。五态:v<150→lo「偏低」;v≤阈值→ok「达标」;阈值<v≤540→hi「偏高」;v>540→dhigh「显著偏高」。
- 安全提醒:v>540 → `high`(M10)。

### 6.5 通用规则
- 软删除/7 天回收站/restore/cron 03:10 物理清理 —— 四张记录表同一套语义。
- streak:当天**任意指标**有 ≥1 条有效记录即计 1 天;含今天向前数连续天数,今天尚无记录则从昨天起算。
- 时区 Asia/Shanghai,measuredAt 存 UTC,"天"按本地日;measuredAt ≤ now+5min 且 ≥ now−1 年。
- note ≤50 字;血糖 tags ∈ 原型 6 个,血压 tags ∈ {服药前,服药后,运动后,情绪波动},血脂/尿酸无 tags。

---

## 7. B 端后台规格(`apps/console`)

### 7.0 定位与角色
- **药房(Pharmacy)**:租户实体。员工账号(PharmacyStaff)分两角色:`owner`(店长,可管员工)、`staff`(店员)。
- **平台管理员(admin)**:管理药房入驻;与药房端共用同一 React 应用,登录后按角色渲染不同菜单(见 7.8)。
- B 端不进手机壳,是标准桌面 Web。

### 7.1 布局与基础组件(同一令牌体系的桌面表达)
- 左侧固定侧栏 220px,`--ink` 深松墨底:顶部 logo 行(白色水滴 + 「糖迹 · 药房工作台」13px)+ 菜单项(40px 行高,图标+文字,激活态 `rgba(91,201,166,.18)` 底 + 左侧 3px `--ok` 竖条 + 白字,非激活 `#9DB8AF`);底部当前登录人(姓名/角色)+「退出登录」。
- 内容区 `--paper` 底:顶栏 56px(白底、底 1px `--line`,左侧页面标题 17px 加粗,右侧药房名 pill);主体 padding 24px,max-width 1200px。
- 桌面组件规格:**表格**(白卡内,表头 12px `--ink-3` 底 1px 线,行高 52px hover `#F7FAF8`,行内状态用原型 pill);**输入框/选择器**(高 36px、圆角 10px、1px `--line`,聚焦品牌描边);**按钮**沿用 `btn.primary/ghost/line`(高度改 36px、字号 13.5px);**统计卡**(白卡:11px 灰标题 + 26px 数字 + 副行);分页用底部「加载更多」按钮(cursor 分页)。Toast/Modal 复用 C 端组件(定位改 viewport 居中/右上)。
- 五态色点组件 `<StatusDot>`:10px 圆点,title 提示「{指标}:{label} {值}」;无数据灰 `#D5DDD9`。

### 7.2 登录页(`/console/login`)
深松绿背景居中白卡(360px):logo + 「药房工作台」+ 用户名/密码 + 「登录」。错误 toast「用户名或密码不正确」。admin 同入口登录。

### 7.3 工作台(`/console/dashboard`)
1. 四枚统计卡:客户总数 / 本周新增客户 / 近 7 天活跃客户(有任意记录)/ **待跟进预警**(红色数字,点击跳预警中心)。
2. 双栏卡片:左「最新预警」(最近 5 条:时间/客户/指标/数值五态色/「去处理」)、右「最近绑定」(最近 5 位客户:昵称/绑定时间/邀请店员)。
3. 数据来自 `GET /api/pharmacy/dashboard` 一次拿齐。

### 7.4 客户管理(`/console/customers`,核心页)
- 工具行:搜索框(昵称,防抖 300ms)+ 筛选 seg「全部 | 有预警 | 7 天未记录」。
- 表格列:**客户**(头像圈+昵称+性别)| **绑定时间** | **最近记录**(「x 小时前 · 血压」式相对时间)| **指标状态**(四枚 StatusDot:血糖/血压/血脂/尿酸各取该客户最新一条的五态)| **操作**「查看」。
- **客户详情**(`/console/customers/:userId`):
  - 头部卡:昵称/性别/绑定于 {日期}/邀请人 {店员};右侧若该客户存在未跟进预警,显示红色提示条「近 7 天 {n} 条异常读数待跟进 → 去处理」。
  - 指标 tab(血糖|血压|血脂|尿酸):每 tab = 概览指标卡行(口径同 C 端统计页该指标的指标卡)+ 趋势图(**调用 shared/chart-options 同一构造器,与 C 端图表完全一致**,range seg 7/30/90 视指标)+ 只读记录表(时间/数值(五态色)/时段或空腹/标签/备注)。
  - 页脚免责 F10。所有数据来自 `/api/pharmacy/customers/:userId/...`,任何未绑定/已解绑客户直接 403 → 前端显示「无权查看该客户(可能已解绑)」空态页。

### 7.5 预警中心(`/console/alerts`)
- 预警定义:**近 N 天内五态 ∈ {dhigh, dlow} 的记录**(四指标合并,服务端 union 查询),不建独立事件表;跟进状态落 `follow_ups`。
- 筛选行:时间(近 7 天|近 30 天)、指标(全部|四类)、状态(未跟进|已跟进|全部,默认未跟进)。
- 表格列:发生时间 | 客户(可点进详情)| 指标 | 读数(五态色,血压显示 `SBP/DBP`)| 状态 pill(未跟进=hi 色 / 已跟进=ok 色)| 操作「标记跟进」→ 弹窗(选填跟进备注 ≤100 字,如"已电话提醒复测")→ `POST /api/pharmacy/alerts/follow-up` → 行内状态即时翻转,toast「已标记跟进」。
- 已跟进行展示跟进人/时间/备注(hover 气泡或次行)。

### 7.6 邀请管理(`/console/invites`)
- 「生成邀请码」按钮 → `POST /api/pharmacy/invites` → 弹层展示:**8 位大写字母数字码**(去除易混淆字符 0/O/1/I)+ **二维码**(qrcode 库绘制,内容 = `{WEB_ORIGIN}/bind-pharmacy?code=XXXX`,C 端打开该链接自动预填邀请码)+「下载二维码 PNG」+「复制邀请码」。有效期 30 天,不限使用次数。
- 列表列:邀请码 | 创建人 | 创建时间 | 已绑定 {n} 人 | 状态(有效/已过期)| 操作(查看二维码 / 停用)。
- 页脚提示 F11(授权告知义务)。

### 7.7 员工管理与药房设置
- 员工(owner 可见):表格(用户名/姓名/角色/状态/创建时间)+「新增员工」(用户名、姓名、初始密码 ≥8 位)+ 停用/启用。staff 访问此页 → 403 空态。
- 设置:药房名称、门店地址、联系电话表单,`PATCH /api/pharmacy/profile`。

### 7.8 平台管理员视图(精简)
admin 登录后菜单仅两项:**平台概览**(药房总数/客户总数/今日记录数三卡)与 **药房管理**(表格:名称/地址/owner 账号/客户数/状态/创建时间;「新增药房」弹窗:名称+地址+电话+owner 用户名+初始密码,创建即生成药房与 owner;停用/启用药房——停用后其全部员工登录与 API 即 403)。

---

## 8. 多租户数据隔离与授权合规(实现要点)

1. **绑定关系**:一个 C 端用户同一时间最多绑定一家药房(`PharmacyCustomer.userId` 上活跃唯一约束);换绑需先解绑。
2. **授权流**:绑定必须由用户在 C 端确认 M6 弹窗后发起,服务端记录 `consentAt`;解绑置 `unboundAt`,**即时**令药房失去包括历史在内的全部访问。
3. **访问控制矩阵**(服务层中间件强制,集成测试覆盖):

| 主体 → 资源 | 自己数据 | 本药房已授权客户 | 他药房客户 / 已解绑客户 | 药房管理接口 | admin 接口 |
|---|---|---|---|---|---|
| C 端用户 | ✅ | — | — | 403 | 403 |
| 药房 staff | — | ✅ 只读 | **403** | 仅本药房;员工管理 403 | 403 |
| 药房 owner | — | ✅ 只读 | **403** | ✅ 本药房 | 403 |
| admin | — | 403(平台不直读客户健康明细) | 403 | 403 | ✅ |

4. **审计**:药房侧每次打开客户详情写 `PharmacyAccessLog(staffId, userId, action:'view_customer', at)`;轻量实现即可(无 UI,留查询接口给 admin 后续使用)。
5. B 端任何客户数据页面必须渲染免责 F10;邀请页渲染 F11。

---

## 9. 数据库 Schema(Prisma,可直接使用;SQLite 兼容写法)

```prisma
model User {
  id String @id @default(cuid())
  openid String @unique
  nickname String @default("微信用户")
  sex String? // male | female | null
  unit String @default("mmol")
  fastingLow Decimal @default(4.4) @db.Decimal(4,2)
  fastingHigh Decimal @default(7.0) @db.Decimal(4,2)
  postMealHigh Decimal @default(10.0) @db.Decimal(4,2)
  deactivatedAt DateTime?
  createdAt DateTime @default(now())
  glucose GlucoseRecord[]; bp BpRecord[]; lipid LipidRecord[]; uric UricRecord[]
  summaries DailySummary[]; binding PharmacyCustomer[]
}

model GlucoseRecord { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id])
  valueMmol Decimal @db.Decimal(4,2); period String
  measuredAt DateTime; tags String @default("[]"); note String @default("")
  deletedAt DateTime?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  @@index([userId, measuredAt(sort: Desc)]) @@index([userId, deletedAt]) }

model BpRecord { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id])
  sbp Int; dbp Int; pulse Int?
  period String // morning|daytime|evening|night
  measuredAt DateTime; tags String @default("[]"); note String @default("")
  deletedAt DateTime?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  @@index([userId, measuredAt(sort: Desc)]) }

model LipidRecord { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id])
  tc Decimal? @db.Decimal(4,2); tg Decimal? @db.Decimal(4,2)
  ldl Decimal? @db.Decimal(4,2); hdl Decimal? @db.Decimal(4,2)
  fasting Boolean @default(true)
  measuredAt DateTime; note String @default("")
  deletedAt DateTime?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  @@index([userId, measuredAt(sort: Desc)]) }

model UricRecord { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id])
  value Int; fasting Boolean @default(true)
  measuredAt DateTime; note String @default("")
  deletedAt DateTime?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  @@index([userId, measuredAt(sort: Desc)]) }

model DailySummary { id String @id @default(cuid()) // 仅血糖
  userId String; user User @relation(fields:[userId],references:[id])
  date String; avg Decimal @db.Decimal(4,2); max Decimal @db.Decimal(4,2)
  min Decimal @db.Decimal(4,2); count Int; okCount Int
  @@unique([userId, date]) }

model Pharmacy { id String @id @default(cuid())
  name String; address String @default(""); phone String @default("")
  disabledAt DateTime?; createdAt DateTime @default(now())
  staff PharmacyStaff[]; customers PharmacyCustomer[]; invites InviteCode[] }

model PharmacyStaff { id String @id @default(cuid())
  pharmacyId String; pharmacy Pharmacy @relation(fields:[pharmacyId],references:[id])
  username String @unique; passwordHash String; name String
  role String @default("staff") // owner | staff
  disabledAt DateTime?; createdAt DateTime @default(now()) }

model InviteCode { id String @id @default(cuid())
  pharmacyId String; pharmacy Pharmacy @relation(fields:[pharmacyId],references:[id])
  staffId String; code String @unique // 8 位,字符集剔除 0O1I
  expiresAt DateTime; disabledAt DateTime?; createdAt DateTime @default(now())
  bindings PharmacyCustomer[] }

model PharmacyCustomer { id String @id @default(cuid())
  pharmacyId String; pharmacy Pharmacy @relation(fields:[pharmacyId],references:[id])
  userId String; user User @relation(fields:[userId],references:[id])
  inviteCodeId String?; inviteCode InviteCode? @relation(fields:[inviteCodeId],references:[id])
  consentAt DateTime @default(now()); unboundAt DateTime?
  @@index([pharmacyId, unboundAt]) @@index([userId, unboundAt]) }

model FollowUp { id String @id @default(cuid())
  pharmacyId String; staffId String
  metric String // glucose|bp|lipid|uric
  recordId String; note String @default("")
  createdAt DateTime @default(now())
  @@unique([pharmacyId, metric, recordId]) }

model PharmacyAccessLog { id String @id @default(cuid())
  pharmacyId String; staffId String; userId String
  action String; createdAt DateTime @default(now())
  @@index([pharmacyId, createdAt]) }

model AdminUser { id String @id @default(cuid())
  username String @unique; passwordHash String; createdAt DateTime @default(now()) }
```

---

## 10. API 契约(REST)

### 10.0 通用约定
- 三组前缀:`/api/app`(JWT aud=app)、`/api/pharmacy`(aud=pharmacy,payload 含 pharmacyId/staffId/role)、`/api/admin`(aud=admin)。aud 不匹配 → 403 `FORBIDDEN`。
- 错误体 `{"error":{"code","message","fields"?}}`;401 UNAUTHORIZED / 403 FORBIDDEN / 404 NOT_FOUND / 409 CONFLICT / 422 VALIDATION_FAILED。
- 全部入参 zod 校验并复用 shared 规则;列表均 cursor 分页 `?limit=50&cursor=`,响应 `{items, nextCursor}`。
- 记录序列化(按指标):
```json
// glucose: {"id","metric":"glucose","valueMmol":7.8,"period":"after_lunch","periodName":"午餐后","measuredAt":"...","tags":[],"note":"","status":{"key":"hi","label":"偏高"}}
// bp:      {"id","metric":"bp","sbp":138,"dbp":86,"pulse":74,"period":"morning","periodName":"晨起","measuredAt":"...","tags":[],"note":"","status":{"key":"hi","label":"偏高"}}
// lipid:   {"id","metric":"lipid","tc":5.4,"tg":1.8,"ldl":3.5,"hdl":1.1,"fasting":true,"measuredAt":"...","note":"","itemStatus":{"tc":"hi","tg":"hi","ldl":"hi","hdl":"ok"},"status":{"key":"hi","label":"边缘升高"}}
// uric:    {"id","metric":"uric","value":418,"fasting":true,"measuredAt":"...","note":"","threshold":420,"status":{"key":"ok","label":"达标"}}
```

### 10.1 C 端 `/api/app`
- `POST /auth/wechat {code}` → `{token,user}`;`WECHAT_MOCK=true` 时任意 code 直接创建/登录 mock 用户,否则走微信 `jscode2session` 适配层(实现接口与错误透传即可,不要求真实联调)。
- `GET /me` → `{id,nickname,sex,unit,target,stats:{totalRecords,coveredDays,streak},binding:{pharmacyName,boundAt}|null}`;`PATCH /me {nickname?,sex?,unit?,target?}`。
- `GET /overview` → 首页一次拿齐:`{streak,todayCount, glucose:{latest|null,target}, bp:{latest|null}, lipid:{latest|null}, uric:{latest|null,threshold}}`(latest 为上面的序列化记录)。
- 记录四资源同构:`GET /records/{metric}`(glucose 支持 `period` 过滤)/`POST /records/{metric}`/`PATCH /records/{metric}/:id`/`DELETE /records/{metric}/:id`(软删)。
  - POST body 按指标:glucose `{value,unit,period,measuredAt,tags?,note?}`;bp `{sbp,dbp,pulse?,period,measuredAt,tags?,note?}`;lipid `{tc?,tg?,ldl?,hdl?,fasting,measuredAt,note?}`(至少一项);uric `{value,fasting,measuredAt,note?}`。
  - 创建/更新响应:`{record, safetyAlert}`,safetyAlert ∈ `"low"|"high"|null`(触发线见 §6;lipid 恒 null)。
- `GET /records/recycle-bin` → 四类混合 `{items:[{...record,deletedAt,daysLeft}]}`;`POST /records/{metric}/:id/restore`。
- `GET /stats?metric=glucose&range=7|30|90` → 血糖完整响应(数值单位一律 mmol/L,前端按用户单位换算展示):
```json
{ "range":7, "n":31, "avg":7.5, "sd":1.4, "cv":19.0,
  "tirLow":0.02, "tirIn":0.81, "tirHigh":0.17, "okRate":0.74,
  "gmi":6.5, "max":12.8, "min":3.4,
  "series":{ "mode":"detail",
    "points":[{"t":"2026-06-04T06:40:00+08:00","v":6.2,"period":"fasting","status":"ok"}] },
  "scatter":[{"periodIndex":3,"v":11.2,"status":"hi"}],
  "byPeriod":[{"period":"fasting","name":"空腹","count":7,"avg":6.3,"okRate":0.86}] }
```
  range=30/90 时 `series.mode="summary"`,`points:[{"date":"2026-05-12","avg":7.9,"min":5.1,"max":12.3,"count":4}]`。
  - `metric=bp`:`{n,avgSbp,avgDbp,avgPulse,okRate,series:[{t,sbp,dbp,status}],byPeriod:[{period,name,count,avgSbp,avgDbp,okRate}]}`
  - `metric=lipid`(忽略 range,全量):`{n,latest,series:[{t,tc,tg,ldl,hdl,status}]}`
  - `metric=uric`:`{n,avg,latest,okRate,threshold,series:[{t,v,status}]}`
- `GET /report/weekly` → `{from,to,sections:{glucose?:...,bp?:...,lipid?:...,uric?:...}}`(各节字段 = 该指标统计子集;7 天内无数据的指标键缺省)。
- `GET /export/csv?metric=glucose|bp|lipid|uric` → 单 CSV(UTF-8 BOM;列见下);`?metric=all` → zip(`糖迹-健康记录-YYYYMMDD.zip`,内含四个 CSV)。列定义:glucose `日期,时间,血糖(mmol/L),血糖(mg/dL),时段,标签,备注`(按时间升序,备注内英文逗号替换为中文逗号);bp `日期,时间,收缩压(mmHg),舒张压(mmHg),脉搏,时段,标签,备注`;lipid `日期,时间,总胆固醇,甘油三酯,低密度脂蛋白,高密度脂蛋白,是否空腹,备注`(单位 mmol/L 写入表头);uric `日期,时间,尿酸(μmol/L),是否空腹,备注`。
- 绑定:`GET /pharmacy/invite/:code` → `{pharmacyName,address,staffName}`(无效/过期/停用 404,T15);`POST /pharmacy/bind {code}` →(已有活跃绑定 409 BINDING_EXISTS)创建绑定记 consentAt → `{binding}`;`DELETE /pharmacy/bind` → 置 unboundAt → 204。

### 10.2 药房端 `/api/pharmacy`
- `POST /auth/login {username,password}` → `{token,staff:{name,role},pharmacy:{name}}`;药房或账号已停用 → 403。
- `GET /dashboard` → `{customerTotal,weekNew,activeIn7d,pendingAlerts,latestAlerts:[...5],latestBindings:[...5]}`。
- `GET /customers?search=&filter=all|alert|inactive7d` → `{items:[{userId,nickname,sex,boundAt,lastRecordAt,lastRecordMetric,dots:{glucose,bp,lipid,uric}}]}`(dots 值=五态 key 或 null)。
- `GET /customers/:userId` → 头部信息+未跟进预警数;`GET /customers/:userId/records?metric=&range=`、`GET /customers/:userId/stats?metric=&range=` → 复用 C 端同名 service(**只读**;每次 detail 访问写 AccessLog)。绑定校验中间件:`pharmacyId` 与 path userId 必须存在活跃 PharmacyCustomer,否则 403。
- `GET /alerts?days=7|30&metric=&status=pending|done|all` → `{items:[{metric,record,customer:{userId,nickname},followUp:{staffName,note,at}|null}]}`;`POST /alerts/follow-up {metric,recordId,note?}` → 幂等(已存在返回既有记录)。
- `POST /invites` → `{code,expiresAt,qrContent}`;`GET /invites` → 列表(含 boundCount);`PATCH /invites/:id {disabled:true}`。
- `GET|PATCH /profile`(owner 可改);`GET|POST|PATCH /staff`(owner;PATCH 支持 `{disabledAt}` 停启用;不可停用自己)。

### 10.3 平台端 `/api/admin`
- `POST /auth/login`;`GET /stats` → `{pharmacyTotal,customerTotal,recordsToday}`;
- `GET /pharmacies`;`POST /pharmacies {name,address,phone,ownerUsername,ownerPassword}`(事务创建药房+owner);`PATCH /pharmacies/:id {disabledAt?}`。

---

## 11. 文案总表(逐字使用;本表完整自含,`{}` 为运行时插值)

### Toast(#T)
T1 请输入血糖值 ▎T2 请输入有效范围内的数值（1.1–33.3 mmol/L，即 20–600 mg/dL） ▎T3 已记录 {值} {单位} ▎T4 已更新 ▎T5 已删除 · 7 天内可在回收站找回 ▎T6 已恢复 ▎T7 已切换为 {单位} · 全部数据自动换算 ▎T8 提醒已开启/提醒已关闭(本期无提醒模块时不用) ▎T9 已导出 {n} 条记录（CSV） ▎T10 长图已保存 ▎T11 演示版未配置协议文本 ▎**T12** 已更新性别 · 尿酸参考上限按 {<420 ｜ <360} 计算 ▎**T13** 已绑定「{药房名}」· 可随时在本页解绑 ▎**T14** 已解绑 · 该药房已无法查看你的记录 ▎**T15** 邀请码无效或已过期 ▎**T16**(B 端)已标记跟进 ▎**T17** 请输入血压值 ▎**T18** 请至少填写一项血脂指标 ▎**T19** 请输入尿酸值 ▎**T20** 收缩压应高于舒张压，请检查输入

### Modal(#M)
- **M1 低血糖**(⚠️/danger-soft):标题「本次血糖偏低」;正文「本次测量 **{值 单位}**，低于 3.9 mmol/L。建议立即进食 **15–20g 速效碳水**（如半杯果汁、3–4 块方糖），**15 分钟后复测**。若出现意识模糊或无法自行处理，请立即就医或呼叫急救。」;小注「本程序不提供诊疗建议，请遵医嘱」;按钮「我已知晓」。
- **M2 血糖显著偏高**(⚠️/hi-soft):标题「血糖显著偏高」;正文「本次测量 **{值 单位}**，明显高于目标范围。如伴有口渴、乏力、恶心等不适，建议**尽快就医**，并注意补充水分。」;小注/按钮同 M1。
- **M3 注销确认**(⚠️/danger-soft):标题「注销并删除全部数据？」;正文「将删除账号下全部 **{n} 条**健康记录及关联数据（n 为四类指标合计），该操作**不可恢复**。如需留底，请先导出数据。」;按钮「再想想」/「确认注销」(红)。
- **M4 免责声明**(ℹ️/brand-soft):标题「免责声明」;正文「「糖迹」仅作健康记录与统计工具，所有数据、图表、估算指标（含 GMI、TIR）与各项参考范围**仅供参考**，不构成任何诊断结论或用药建议。请勿据此自行调整药物，治疗方案请遵医嘱。」;按钮「我已知晓」。
- **M5 删除确认**(🗑/#EFF3F1):标题「删除这条记录？」;正文「删除后 7 天内可在「我的 → 回收站」找回，逾期将彻底清除。」;按钮「取消」/「删除」(红)。
- **M6 授权确认**(ℹ️/brand-soft):标题「授权数据查看」;正文「绑定「{药房名}」后，该药房的工作人员将可以查看你在糖迹记录的全部健康数据（血糖、血压、血脂、尿酸），用于为你提供用药提醒与健康管理服务。你可以随时在「我的 → 服务药房」解绑，解绑后立即终止其全部访问（含历史数据）。」;按钮「暂不」/「同意并绑定」。
- **M7 解绑确认**(⚠️/danger-soft):标题「解除与「{药房名}」的绑定？」;正文「解绑后该药房将立即无法查看你的任何记录（含历史数据）。如需再次获得服务，可重新输入邀请码绑定。」;按钮「再想想」/「确认解绑」(红)。
- **M8 血压偏高**(⚠️/hi-soft):标题「本次血压偏高」;正文「本次测量 **{sbp}/{dbp} mmHg**，明显高于参考范围。建议静坐休息 5 分钟后复测；若仍明显偏高，或伴有剧烈头痛、胸闷、视物模糊等不适，请立即就医。」;小注「本程序不提供诊疗建议，请遵医嘱」;按钮「我已知晓」。
- **M9 血压偏低**(⚠️/danger-soft):标题「本次血压偏低」;正文「本次测量 **{sbp}/{dbp} mmHg**，低于参考范围。若伴有头晕、乏力、出冷汗等不适，请坐下休息，必要时及时就医。」;小注/按钮同 M8。
- **M10 尿酸显著偏高**(⚠️/hi-soft):标题「尿酸显著偏高」;正文「本次测量 **{value} μmol/L**，明显高于参考上限。建议注意多饮水，并尽快就医复查。」;小注/按钮同 M8。

### 录入实时状态行(#S)
- 血糖:空「输入血糖值」;无法解析「继续输入…」;ok「达标 · 在 {下}–{上} 目标内」;hi「偏高 · 超过目标 {上} {单位}」;lo「偏低 · 低于目标 {下} {单位}」;dlow「低血糖风险 · 保存后会给出处理建议」;dhigh「显著偏高 · 保存后会给出建议」。
- 血压:空「输入血压值」;填写中「继续输入…」;ok「正常 · 家庭自测参考 <135/85」;hi「偏高 · 建议规律复测」;dhigh「明显偏高 · 保存后会给出建议」;dlow「偏低 · 保存后会给出建议」。
- 尿酸:空「输入尿酸值」;ok「达标 · 参考上限 <{t} μmol/L」;hi「偏高 · 高于参考上限 {t}」;dhigh「显著偏高 · 保存后会给出建议」;lo「偏低 · 低于参考下限 150」。

### 空态 / 脚注(#E/#F)
- E1(血糖 hero 空)「还没有记录\n点下方水滴按钮，记下第一条血糖」 ▎E3(历史筛选空)血糖时段筛选空「该时段暂无记录」,其他指标无记录「暂无{指标名}记录」 ▎E4(回收站空)「回收站为空 · 删除的记录会在这里保留 7 天」
- E5(B 端客户列表空)「还没有客户 · 到「邀请管理」生成邀请码，发展你的第一位客户」 ▎E6(预警空)「近 {n} 天没有待跟进的异常读数」 ▎E7(首页指标卡空)「还没有{指标名}记录 · 点下方按钮记一笔」
- F1(各指标统计页尾)「以上统计仅供参考，不构成诊疗建议，请遵医嘱。」血糖统计页追加第二行「GMI 基于 CGM 研究公式估算，请以静脉血 HbA1c 为准。」
- **F2**(报告页脚)「控糖目标：空腹 {a}–{b}，餐后 2h < {c} {单位}（用户自设）。估算 GMI {x}%，仅供参考。血压参考 <135/85 mmHg（家庭自测），血脂、尿酸参考范围见各分节标注。\n本报告由「糖迹」自动生成，仅作记录摘要，不构成诊疗建议，请遵医嘱。生成时间：{M月D日 HH:mm}」
- F3(我的页尾)「糖迹仅作记录工具，不提供诊断与用药建议，请遵医嘱」 ▎F4(历史截断)「仅展示最近 14 天 · 更早数据见「统计」与导出」 ▎F5(历史页尾)「点击记录可编辑或删除 · 删除后 7 天内可在回收站找回」 ▎F6(目标组尾)「出厂默认值仅供参考，请按医嘱设置自己的控糖目标」 ▎F8(报告按钮下)「长图可直接转发给医生或家人群 · 导出含全部明细」
- F9「仅血糖支持 mmol/L 与 mg/dL 切换，血压、血脂、尿酸使用固定单位」
- **F10**(B 端客户数据页脚)「以上数据由客户本人记录并授权查看，仅供健康管理参考，不构成诊疗依据；请勿据此指导用药，医疗问题请建议客户及时就医」
- **F11**(邀请管理页脚)「发展客户时请当面告知：绑定后本药房可查看其健康记录，客户可随时自行解绑」

---

## 12. 种子数据(`prisma/seed.ts`,确定性,可重复执行)

随机源 `mulberry32(20260610)` + Box–Muller,跑前清空再写。

### 12.1 演示患者 `seed_demo`(openid="seed_demo",昵称「微信用户_8462」,性别 male)
- **血糖 89 天**:生成器参数逐字如下(`shift=0.55×(ago/89)` 加在均值上;值 clamp [2.9,16.9];2.2% 概率改写为 3.1+rng()×0.7;v>10 且 rng()<0.3 附「聚餐/加餐」;v<3.9 附「运动后」+备注「运动量偏大，下次提前加餐」):

| period | p | 时刻 h±j 分 | m | s |
|---|---|---|---|---|
| fasting | 1.00 | 6.7±40 | 6.25 | 0.85 |
| after_breakfast | 0.72 | 9.4±30 | 8.5 | 1.7 |
| before_lunch | 0.25 | 11.4±20 | 6.7 | 1.0 |
| after_lunch | 0.78 | 13.8±35 | 8.9 | 1.8 |
| before_dinner | 0.22 | 17.4±25 | 6.9 | 1.0 |
| after_dinner | 0.74 | 19.9±35 | 8.6 | 1.7 |
| bedtime | 0.42 | 22.1±30 | 7.3 | 1.1 |
| dawn | 0.05 | 3.2±40 | 5.7 | 0.8 |
| random | 0.10 | 15.8±50 | 7.9 | 1.6 |

  今天固定 3 条:06:52 空腹 6.1;09:26 早餐后 8.2(备注「燕麦 + 鸡蛋」);13:47 午餐后 11.2(标签「聚餐」,备注「同事聚餐，米饭偏多」)。
- **血压 89 天**:晨起 p=0.9(07:00±40m)、夜间 p=0.7(21:40±40m);SBP=gauss(132+10×(ago/89), 8) 取整 clamp[95,205],DBP=round(SBP×0.62+gauss(0,5)) clamp[55,125] 且 <SBP,pulse=gauss(72,8) 取整。固定脚本:ago=2 晚间 178/106(dhigh);ago=1 晨起 186/112(dhigh,触发安全线);今天 07:05 晨起 138/86(hi)。
- **血脂 3 条**(ago 85/45/8):TC 6.4→5.9→5.4;TG 2.6→2.1→1.8;LDL 4.3→3.9→3.5;HDL 0.9→1.0→1.1;均空腹。
- **尿酸 5 条**(ago 80/60/40/20/6):470 / 455 / 440 / 432 / 418,均空腹。
- 生成后构建血糖 daily_summary。

### 12.2 药房与后台
- 药房 A「康宁大药房 · 中山路店」:owner `kangning / Kn@123456`(店长 王建国),staff `kn_li / Kn@123456`(店员 李雯);邀请码 `KN23DEMO`(李雯创建,30 天有效)。
- 药房 B「百姓缘药房 · 解放路店」:owner `baixingyuan / Bxy@123456`(店长 赵敏)。
- 平台管理员:`admin / ${ADMIN_INIT_PASSWORD:-Admin@123456}`。
- 绑定:seed_demo 经 `KN23DEMO` 绑定药房 A。
- **10 位演示客户**(昵称取数组「陈阿姨/老周/林女士/吴先生/小郑/孙阿姨/老何/苏女士/大刘/方先生」,性别交替):8 位绑药房 A、2 位绑药房 B;每位生成近 30 天稀疏数据(血糖 p=0.6/天 1–2 条,血压 p=0.4/天);其中固定三处预警(近 7 天内):客户#2 血糖 17.8(ago=3)、客户#5 血压 184/110(ago=2)、客户#7 尿酸 560(ago=4);客户#9、#10 最近 7 天无任何记录(用于「7 天未记录」筛选)。
- README 必须给出上述全部演示账号表与一段「3 分钟演示路径」。

---

## 13. 测试与验收

### 13.1 shared 算法单测(Vitest)
**血糖(基线用例)**:换算 toMmol(200,'mgdl')≈11.11、disp(6.1,'mgdl')="110"、mmol↔mgdl 往返误差 ≤0.06;推断边界 04:59→dawn、05:00→fasting、08:59→fasting、09:00→after_breakfast、11:59→before_lunch、12:00→after_lunch、14:59→after_lunch、15:00→random、18:29→before_dinner、18:30→after_dinner、21:29→after_dinner、21:30→bedtime、00:00→dawn;五态(默认目标,比较前四舍五入 2 位小数)3.89→dlow、3.9→lo、4.39→lo、4.4→ok、空腹 7.0→ok / 7.1→hi、餐后 10.0→ok / 10.1→hi、16.7(超上限)→hi、16.71→dhigh、33.3→dhigh;合法域 1.0 拒 / 1.1 收 / 33.3 收 / 33.4 拒,mgdl 19 拒 / 20 收 / 600 收 / 601 拒;GMI avg=7.5→6.5;TIR [3.5,5,8,10,10.1]→低 .2 / 内 .6 / 高 .2;CV 与 streak 各给构造用例。
**新增**:
- 血压五态:89/70→dlow;90/59→dlow;134/84→ok;135/84→hi;134/85→hi;159/99→hi;160/99→dhigh;159/100→dhigh;校验 sbp≤dbp(120/130)拒、sbp 301 拒、pulse 25 拒;safety:179/109→null,180/108→high,90/60 →(ok 域内)null,89/60→low。
- 血压时段:03:59→night;04:00→morning;09:59→morning;10:00→daytime;16:59→daytime;17:00→evening;21:59→evening;22:00→night。
- 血脂:TC 5.19/5.2/6.19/6.2 → ok/hi/hi/dhigh;TG 1.69/1.7/2.29/2.3;LDL 3.39/3.4/4.09/4.1;HDL 1.0→ok、0.99→hi;整体=最严重(ldl=4.2 其余 ok → dhigh);四项全空 → 校验失败。
- 尿酸:male 420→ok、421→hi、540→hi、541→dhigh(safety high);female 360/361 分界;sex=null 按 420;149→lo、150→ok 下界。
- streak 跨指标:昨天仅血压、今天仅尿酸 → 2;今天无任何记录但昨起连续 3 天 → 3。

### 13.2 API 集成测试(supertest,内存 SQLite)
**血糖(基线用例)**:无 token 401;POST 非法值 422 且不落库;POST 3.5 → 201 且 safetyAlert="low";POST 17.0 → "high";PATCH 改值后 status 重判;DELETE → 列表消失、回收站出现 daysLeft=7;restore 后回归;stats range=7 mode=detail、range=30 mode=summary 且与手算一致;CSV 含 BOM、表头与行数正确;PATCH /me 非法目标 422;deactivate 后旧 token 全部 401。
**新增**:
- 四指标 CRUD 与 safetyAlert:POST bp 186/112 → `"high"`;POST uric 560 → `"high"`;POST lipid 恒 null;非法体 422 不落库。
- **权限矩阵 8 条(必须全过)**:① 药房 A token 取药房 B 客户详情 → 403;② 客户解绑后原药房再取 → 403;③ C 端 token 调 `/api/pharmacy/*` → 403;④ staff 调员工管理 → 403;⑤ admin 调客户健康数据接口 → 403;⑥ 药房被停用后其员工任意请求 → 403;⑦ 无效/过期邀请码预览 → 404;⑧ 已绑定用户再次 bind 另一药房 → 409。
- 绑定链路:预览→bind(consentAt 写入)→药房客户列表出现→unbind→列表消失且详情 403。
- alerts:构造 dhigh 记录后出现在 `status=pending`;follow-up 后转 done 且重复提交幂等;dashboard 四数字与构造数据一致。
- invites:码长 8、字符集不含 0O1I、过期/停用后预览 404;export `metric=all` 返回 zip 且包含 4 个 CSV、glucose CSV 含 BOM 表头正确。

### 13.3 验收清单(完成后逐项自检写入 docs/SELF-CHECK.md)
**A · 血糖像素(对照 prototype.html)**:A1 手机框架 390×844 双圆角与深绿桌面;A2 假状态栏+微信胶囊;A3 TabBar 中央水滴按钮上浮 26px;A4 hero 渐变/54px 大数字/gauge 目标带与圆点;A5 录入键盘布局(保存键纵跨 3 行竖排)与逐键实时变色五档文案;A6 输入 3.5/17.2 → M1/M2(340ms 延迟,加粗位置一致);A7 时段自动推断与「已按当前时间推荐」消隐逻辑;A8 mmol/mgdl 输入位数规则与全站换算联动 T7;A9 目标 stepper 0.1 步进全站联动;A10 7 天明细点色 / 30·90 汇总带切换与图注 —— 其余视觉细节以原型逐项目测,不一致即修。
**B · 多指标 C 端**:B1 首页四卡顺序/识别色眉行/五态数值色;B2 录入弹层指标 seg 四面板切换,血压三字段自动跳焦,sbp≤dbp 触发 T20;B3 血脂至少一项校验 T18 与逐项五态圆点;B4 尿酸性别阈值随「我的」性别切换即时变化(T12);B5 历史页一级指标 seg、血糖二级时段 chips、四类记录卡形态正确;B6 统计页四指标各自图表与参考线(135/85、LDL 3.4、尿酸阈值+540);B7 健康周报按有数据指标动态分节,长图与 zip 导出可用;B8 回收站四类混合、恢复正常。
**C · 药房后台**:C1 侧栏布局/激活态/角色菜单差异(staff 无员工管理,admin 仅两菜单);C2 工作台四卡与两列表数据正确;C3 客户列表四枚 StatusDot 颜色=各指标最新五态,三种筛选有效;C4 客户详情趋势图与 C 端同数据完全一致(同一 option 构造器);C5 预警中心筛选/标记跟进/幂等/跟进人备注展示;C6 生成邀请码:8 位无易混字符、二维码可下载、C 端扫码链接自动预填;C7 员工新增/停用,owner 不能停用自己;C8 admin 新增药房即得 owner 账号可登录,停用药房后其员工被拒。
**D · 合规与隔离**:D1 绑定必经 M6 授权弹窗,文案逐字;D2 解绑即时:解绑后药房刷新任何该客户页面均 403 空态;D3 全站无任何疾病/分级诊断名词(全文检索「高血压」「糖尿病」「痛风」「高脂血症」仅允许出现在本规格与代码注释,UI 文案零出现);D4 B 端客户页 F10、邀请页 F11 存在;D5 AccessLog 在查看客户详情时落库;D6 安全提醒 M8/M9/M10 触发线准确。

### 13.4 Definition of Done 与 E2E
`pnpm lint / test / e2e` 全绿;SELF-CHECK 四组清单全勾;README 可一键复现。
**E2E 5 条**:① C 端登录→录入血糖 7.8→首页今日出现绿色达标条目;② 录入 3.5→断言 M1 标题与「15–20g 速效碳水」;③ 我的切 mg/dL→hero 数值整数化且单位变化;④ C 端用 `KN23DEMO` 走完 M6 绑定→药房 A 登录→客户列表出现该用户;⑤ C 端录入血压 185/115→出现 M8→药房 A 预警中心出现该条并可标记跟进。

---

## 14. 执行策略(按序推进,每阶段提交)
- **P0** 体验并通读 prototype.html → monorepo 脚手架与 TS/ESLint 基线。
- **P1** `packages/shared`:四指标全部纯函数 + chart-options + §13.1 单测全绿。
- **P2** API:schema + seed → app 路由 → pharmacy/admin 路由与权限中间件 → cron → §13.2 全绿(**权限矩阵优先写测试再实现**)。
- **P3** C 端壳 + global.css 移植 + 登录 + 血糖四页(像素优先,对照原型)。
- **P4** C 端多指标扩展(录入面板→首页四卡→历史→统计→周报→绑定流)。
- **P5** B 端 console(布局→登录→工作台→客户→预警→邀请→员工/设置→admin 视图)。
- **P6** E2E 五条 + SELF-CHECK + README(演示账号表、3 分钟演示路径、Open Decisions)。
通用准则:小步提交;禁止前端写死数据冒充接口;视觉拿不准就读原型 CSS;规格未覆盖先看原型、再自行决策并记录。

---

## 附录 A · 相对原型的「允许差异」清单
1. 登录页、绑定药房子页、回收站子页、B 端全部 —— 原型没有,按本规格新建(沿用设计体系)。
2. 首页从单 hero 扩展为四指标卡(血糖 hero 本身不变);录入弹层新增指标 seg;统计/历史新增一级指标 seg;报告改名「健康周报」并动态分节。
3. 「保存长图」「导出」为真实实现;原型中各「演示版…」toast 凡功能已真做的,替换为 §11 对应文案。
4. 桌面侧栏「试一试」仅 `?demo=1` 显示;假状态栏与微信胶囊保留。
5. 提醒(Reminder)模块**不在本期范围**(为药房服务让位、控制范围;schema 不建 Reminder 表,原型「我的」页的提醒分组不实现)。

## 附录 B · 微信小程序迁移备注(本期不实现)
shared 零 DOM 依赖可直接复用;`/api/app` 契约不变,fetch 换 `wx.request`、登录换 `wx.login`;C 端 UI 以同套令牌用 WXML/WXSS 重写,图表换 echarts-for-weixin;B 端保持 Web。

## 附录 C · V1 → V3 变更摘要(供人工 review)
四指标(血糖/血压/血脂/尿酸,各自独立表与权威算法,血糖口径零变化)| 新增 B 端 console(药房工作台 + admin 视图)与 `/api/pharmacy` `/api/admin` 路由 | 新增邀请码绑定 + 显式授权 + 解绑即时失效 + 访问审计的多租户隔离体系 | streak 改为跨指标口径 | 周报多指标动态分节,导出支持 zip | 用户档案新增性别(尿酸阈值)| 移除提醒模块 | 文案新增 T12–T20、M6–M10、S 血压/尿酸档、E5–E7、F9–F11。
