# STYLE-DIFF

| 页面 | 差异点 | 原因 | 状态 |
|---|---|---|---|
| 血糖首页 | `visual-diff-summary.json`：changedPixels 0，changedRatio 0，averageDelta 0 | 已对齐 hero TIR 固定带 3.9–10.0、离屏 sheet 合成高度、血压小字亚像素宽度、FAB 与 TabBar SVG 结构；截图已落 `prototype-glucose-home.png` / `app-glucose-home.png` / `diff-glucose-home.png` | 已清零 |
| 录入弹层 | `visual-diff-summary.json`：changedPixels 0，changedRatio 0，averageDelta 0 | React 弹层已补齐原型 time icon、指标图标、备注输入、删除 SVG 与数据发送路径；diff 图每次由脚本重写 | 已清零 |
| C 端周报/回收站 | 已接入真实 API；未追加截图文件 | 原型已有 `.report/.subpage/.rec` 类，React 复用设计语言 | 可接受 |
| B 端后台 | 已生成 `docs/screenshots/console-dashboard.png`，数据内容不同 | 真实 API 数据替代原型内存数据 | 可接受 |

tokens.css 与原型 `:root` 由 `scripts/extract-styles.mjs` 自动校验。
自动视觉 diff 命令：`node scripts/visual-diff.mjs`。

## 扫描记录

- 合规文案扫描：`rg "糖尿病|高血压|高脂血症|痛风|诊断|用药建议" apps packages README.md`，仅命中 C 端页脚标准免责声明「不提供诊断与用药建议」。
- 裸色扫描：`rg "#[0-9A-Fa-f]{3,8}|rgba\\(" apps packages --glob '!packages/ui/styles/*.css' --glob '!**/dist/**'`，剩余命中为 SVG 白色 `#fff` 以及 GOAL 指定无数据灰 `#D5DDD9`；提取 CSS 内裸色来自原型，允许保留。
