# 「糖迹」V2 · Codex GOAL 完整执行提示词

> **用法**:将本文件保存为仓库内 `docs/GOAL.md`(替换旧版),确保 `docs/SPEC.md` 与 `design/prototype.html` 在位,然后执行文末 §10 的命令。
> **本文定位**:执行总纲 + 样式一致性权威。业务规则/接口/文案/测试以 `docs/SPEC.md` 为准;**一切视觉与交互观感以 `design/prototype.html` 为准**;两者由本文的映射规则衔接。冲突裁决顺序:原型实际渲染效果 > SPEC 文字描述 > 本文 > 自行决策(记入 README「Open Decisions」)。

---

## 0. 角色与任务

你是一名资深全栈工程师。在当前仓库从零实现「糖迹」V2 —— 慢病健康记录产品:患者端移动 Web(血糖/血压/血脂/尿酸四指标)、药房后台桌面 Web(客户管理/预警跟进/邀请码)、Fastify+Prisma 后端。**本任务的成败判据有两条,缺一不可:① SPEC 的 Definition of Done 全部满足;② 最终界面与 `design/prototype.html` 的样式保持一致(血糖部分逐像素,其余部分同一设计语言、令牌零偏差)。**

`design/prototype.html` 是一个单文件双端演示原型:左侧 `.pane-c` 内是患者端完整手机壳,右侧 `.pane-b` 内是药房后台完整桌面壳。打开浏览器完整体验它、并通读其内联 `<style>` 与 `<script>`,是 P0 的第一项工作。

---

## 1. 样式一致性铁律(最高优先级,违反即返工)

1. **移植,禁止重写。** 不允许"看着原型凭印象写 CSS"。必须用脚本从 `design/prototype.html` 中机械提取 `<style>` 全文,落为项目共享样式;所有色值、尺寸、圆角、阴影、缓动参数与原型逐字节一致。
2. **样式分层落盘(P0 完成)**:
   - `packages/ui/styles/tokens.css` —— 原型全部 `:root` 令牌,逐字(见 §2);
   - `packages/ui/styles/base.css` —— reset、字体栈、`tabular-nums` 数字类;
   - `packages/ui/styles/mobile.css` —— 原型 C 端全部组件类(`.device/.screen/.statusbar/.navbar/.hero/.mcard/.sheet/.keypad/.tabbar/.fab/.chip/.seg/.pill/.cell/.stepper/.switch/.toast/.modal/.asheet/.rec/.card/.metric/.tirbar/.report/.bignum/.bp-fields/.lp-rows/.code-in/.ph-card/.bound-cell/...`);
   - `packages/ui/styles/console.css` —— 原型 B 端全部组件类(`.bshell/.bside/.bmenu/.btop/.bbody/.bstats/.bstat/.bcard/.btab/.btools/.bsearch/.bbtn/.itab/.sdot/.alertbar/.avatar-s/.bmodal/.btoast/.blogin/...`)。
3. **类名与 DOM 结构保留。** React 组件的 `className` 直接复用原型类名,DOM 层级尽量与原型一致;这样移植的 CSS 无需改造即可生效。不要把原型类名改写成 BEM/CSS Modules——演示原型即设计交付物,保真优先。
4. **新增样式必须基于既有令牌**(颜色只能引用 `var(--*)`),禁止出现任何新的裸色值;确需新增令牌,先在 tokens.css 注册并在 `docs/STYLE-DIFF.md` 记录理由。
5. **双端共用同一套 tokens**;`apps/web` 引 tokens+base+mobile,`apps/console` 引 tokens+base+console。
6. **截图比对验收(强制流程)**:每完成一个页面,用 Playwright 对实现页与原型对应区域各截一张图(390 宽 / B 端 1120 宽),并排存入 `docs/screenshots/`,差异记入 `docs/STYLE-DIFF.md`(页面 | 差异点 | 原因 | 状态)。任务结束时,血糖四页 + 录入弹层差异表必须为空;其余页面只允许"数据内容不同"类条目,不允许"颜色/尺寸/圆角/字号/布局不同"类条目。

---

## 2. 设计令牌(与原型逐字一致,实现后必须 diff 校验)

```css
:root{
  --ink:#16302B; --ink-2:#41534E; --ink-3:#7A8A85;
  --paper:#F2F5F3; --card:#FFFFFF; --line:#E4EAE7;
  --brand:#0E7E6B; --brand-deep:#0A5A4C; --brand-soft:#E2F1EC;
  --ok:#19A77E;  --ok-soft:#E4F5EE;
  --hi:#E8833A;  --hi-soft:#FCEFE3;
  --danger:#D6453D; --danger-soft:#FBE9E7;
  --lo:#4A7DDB;  --lo-soft:#E9F0FC;
  --desk:#0F2420;
  --r-card:18px;
  --shadow-card:0 1px 2px rgba(22,48,43,.05),0 6px 18px rgba(22,48,43,.05);
  --font:-apple-system,BlinkMacSystemFont,"PingFang SC","MiSans","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif;
  /* 指标识别色(仅图标底/卡片眉/tab 强调,不得给数值着色) */
  --m-glucose:#0E7E6B; --m-glucose-soft:#E2F1EC;
  --m-bp:#3E63C9;      --m-bp-soft:#E8EDFA;
  --m-lipid:#C77B33;   --m-lipid-soft:#FAF0E3;
  --m-uric:#7A5BBF;    --m-uric-soft:#F0EAFA;
}
```

**数值语义五态着色(全站唯一来源)**:`ok→var(--ok)`、`hi→var(--hi)`、`lo→var(--lo)`、`dhigh/dlow→var(--danger)`、无数据 `#D5DDD9`。凡测量数值出现处(大数字、列表、图表点、B 端状态点)颜色一律由五态决定。

---

## 3. 关键组件像素规格速查(验收锚点;完整规格以原型 CSS 为准)

| 组件 | 钉死数值 |
|---|---|
| 手机壳 | `.device` padding 11px、radius 58px、渐变 `160deg,#22332E→#0B1714`;`.screen` **390×844**、radius 47px、底 `--paper` |
| 桌面背景 | `body` 背景 `--desk`(#0F2420) |
| 血糖 hero | 渐变 `155deg,#1B4A40→#0E2C26`、radius 22px、padding 19px 20px 17px、大数字 54px、2–20 量程 gauge+目标带 |
| 中央记录按钮 | `.fab` 58×58、radius 20px、上浮 top:-26px、渐变 `150deg,#15B189→var(--brand-deep)`、外发光 `0 8px 20px rgba(14,126,107,.42)` |
| 录入弹层 | `.sheet` radius 26px 26px 0 0、入场 `transform .28s cubic-bezier(.32,.72,.25,1)`、max-height 92% |
| 键盘 | `.keypad` 底 #EBF0ED、4 列网格、行高 54px、gap 7px、radius 22px 22px 0 0;保存键纵跨 3 行、竖排(`writing-mode:vertical-lr`)、letter-spacing .3em、`--brand` 底 |
| 录入大数字 | 64px 实时五态变色 + 闪烁光标;血压三字段 `.bpf` 激活态 `--brand` 描边、字号 31px |
| 页面/弹窗动效 | page 切换 .22s、modal .2s scale(.92→1)、toast .22s 显隐 + 2.1s 自动消失、`prefers-reduced-motion` 全部禁用 |
| 指标 seg | `.msg` 底 #E8EEEB、radius 11px、选中白底 + 阴影 `0 1px 4px rgba(22,48,43,.12)` |
| B 端外壳 | `.bshell` **1120×844**、radius 22px;`.bside` 宽 208px、底 `--ink`、文字 #9DB8AF;菜单激活 `rgba(91,201,166,.16)` 底 + 左侧 3px `--ok` 竖条 + 白字 |
| B 端顶栏/表格 | `.btop` 高 54px 白底;`.btab` 表头 11px `--ink-3`、行 hover `#F7FAF8` |
| 数字排版 | 所有数值加 `.num`(`font-variant-numeric:tabular-nums`);全站字体 `--font` |

---

## 4. 原型 → 真实项目 映射规则(防走样、防过度工程)

| 原型中 | 真实项目中 |
|---|---|
| 顶部「双端联动」切换器、左右并排布局 | **不实现**。那是演示装置;`apps/web` 与 `apps/console` 是两个独立应用、独立路由 |
| C 端手机壳 `.device` | 保留:桌面访问时居中手机壳(SPEC §13.3-A1);视口 ≤480px 时 `.screen` 全屏(宽 100vw、radius 0、隐藏壳) |
| 单文件内存数据、C 端录入后 B 端"实时"出现 | 等价实现 = 走真实 API:B 端预警/客户页**每 30s 轮询 + 手动刷新按钮**即可,不要求 WebSocket |
| `WECHAT_MOCK` 登录、B 端登录预填演示账号 | 真实登录页;仅 URL 带 `?demo=1` 时预填演示账号(账号见 SPEC §12) |
| 「长图已保存（演示）」「打包导出…（演示）」等 toast | **真实实现**:html2canvas 长图、archiver zip(SPEC §10.1),toast 用 SPEC §11 正式文案 |
| 伪二维码(canvas 示意图样) | 真二维码:`qrcode` 库,内容 `{WEB_ORIGIN}/bind-pharmacy?code=XXXX`,C 端打开自动预填 |
| 「演示版不执行真实注销/停用」 | 真实实现(注销软删用户、员工停用),交互文案按 SPEC §11 |
| 数据由 `mulberry32(20260610)` 前端生成 | 同参数移到 `prisma/seed.ts`(SPEC §12),前端禁止内置数据 |
| 原型未覆盖之处(如 admin 视图) | 按 SPEC §7.8 实现,样式复用 console.css 既有组件 |

---

## 5. 交互一致性清单(行为与时序照搬原型)

- 血糖键盘:mmol 模式最多 2 位整数 + 1 位小数,mg/dL 模式 3 位整数禁小数点;逐键实时五态变色,状态行五档文案(SPEC §11-S)。
- 血压键盘:三字段 SBP→DBP→脉搏;满 3 位自动跳焦,「·」键变「下一项」,删除键空字段时回跳上一字段;SBP≤DBP 时保存报 T20。
- 血脂面板:四行 input(隐藏数字键盘、显示底部保存条),逐项实时五态圆点,至少一项才可保存;尿酸:整数键盘,「·」键置灰。
- 时段:按 `recTime` 自动推断 + 「已按当前时间推荐」hint,手动选择后 hint 消隐且不再跟随时间变化。
- 保存链路时序:校验 → POST → toast(逐字)→ 关闭弹层 → **340ms 后**按响应 `safetyAlert` 弹 M1/M2/M8/M9/M10。
- 子页(周报/绑定/回收站)右滑入;绑定流:输码 → 查询预览药房卡 → 「同意授权并绑定」→ **M6 授权弹窗(文案逐字)** → 绑定;解绑走 M7,B 端立即 403。
- B 端:客户行点击进详情;预警「标记跟进」弹备注框,确认后行内状态即时翻转;客户列表三筛选(全部/有预警/7 天未记录)与搜索防抖 300ms。

---

## 6. 产出与架构(细节见 SPEC §0–§3、§9、§10)

pnpm monorepo:`apps/web`(React18+Vite+Zustand+react-router)、`apps/console`(同栈)、`apps/api`(Fastify+Prisma+SQLite,JWT 三 aud)、`packages/shared`(四指标纯函数 + **ECharts option 构造器,C/B 复用同一构造器**)、`packages/ui`(§1 的样式包)。禁止引入 SPEC §2 之外的运行时依赖;禁止任何 CSS 框架与 UI 组件库。

---

## 7. 阶段计划(严格按序;每阶段:自测 → `git commit -m "P{n}: ..."`)

- **P0** 浏览器体验原型 → 写 `scripts/extract-styles.mjs` 从原型提取 `<style>` 生成 §1 的四个 css 文件(含自动 diff 校验:tokens 与原型 `:root` 逐字一致)→ monorepo 脚手架。
- **P1** `packages/shared`:血糖/血压/血脂/尿酸全部纯函数 + chart-options + SPEC §13.1 单测全绿。
- **P2** `apps/api`:schema + seed(SPEC §12 参数逐字)→ `/api/app` → `/api/pharmacy` `/api/admin` + 权限中间件(**先写 §13.2 权限矩阵 8 条测试再实现**)→ cron → 集成测试全绿。
- **P3** `apps/web` 壳(device/screen/statusbar/tabbar/fab)+ 登录 + 血糖四页与录入键盘 —— 完成后对原型左侧逐像素截图比对,STYLE-DIFF 血糖部分清零。
- **P4** `apps/web` 多指标:录入四面板 → 首页四卡 → 历史/统计四指标 → 健康周报 → 绑定/解绑授权流 → 回收站;逐页截图比对。
- **P5** `apps/console`:布局 → 登录 → 工作台 → 客户列表/详情(图表用 shared 同一构造器)→ 预警中心 → 邀请管理(真二维码)→ 员工/设置 → admin 视图;对原型右侧截图比对。
- **P6** Playwright E2E 5 条(SPEC §13.4)+ `docs/SELF-CHECK.md`(§13.3 四组清单逐项)+ `docs/STYLE-DIFF.md` 收敛 + README(一键启动、演示账号表、3 分钟演示路径、Open Decisions、Known Issues)。

---

## 8. Definition of Done

1. `pnpm install && pnpm dev` 同时拉起 api/web/console;`pnpm test` 全绿;`pnpm e2e` 5 条可跑。
2. 演示链路可走通:console 生成邀请码 → web 绑定授权(M6)→ web 录入血压 185/115(M8)→ console 预警中心出现并标记跟进 → web 解绑 → console 该客户 403。
3. **样式 DoD**:`docs/STYLE-DIFF.md` 中血糖四页+录入弹层零差异;全部页面无"颜色/尺寸/布局"类未解决差异;tokens.css 与原型 `:root` diff 为空;全仓库 `grep` 不到 tokens 之外的新增裸色值(SVG 内嵌色除外)。
4. `docs/SELF-CHECK.md` 四组验收清单(SPEC §13.3 A/B/C/D)逐项标记,未达项附原因。

## 9. 行为准则

规格未覆盖先看原型、再自行决策并记录;禁止伪造测试结果或注释掉失败用例;外部环境故障(如浏览器二进制下载失败)记入 Known Issues 后继续其余工作;结束时输出:各阶段完成情况、测试摘要、STYLE-DIFF 与 SELF-CHECK 未达项。

---

## 10. 配套执行命令

```bash
cd ~/tangji   # 已按命令包完成准备:docs/SPEC.md、design/prototype.html、本文件存为 docs/GOAL.md

# 一把梭
codex exec --full-auto -c sandbox_workspace_write.network_access=true \
  "通读 AGENTS.md、docs/GOAL.md、docs/SPEC.md 与 design/prototype.html,严格按 GOAL.md §7 的 P0→P6 依次执行,以 GOAL.md §8 的 Definition of Done(含样式 DoD)为完成标准,中途不要等待确认。"

# 分段跑(推荐):把上面引号内的「P0→P6」依次换成「P0–P2」「P3–P4」「P5–P6」,每段之间人工核对
# 断点续跑:
codex exec --full-auto -c sandbox_workspace_write.network_access=true \
  "检查仓库进度(git log、测试结果、docs/STYLE-DIFF.md),对照 docs/GOAL.md 找出未完成阶段与未清零的样式差异,从断点继续直至 §8 DoD 全部满足。"
```
