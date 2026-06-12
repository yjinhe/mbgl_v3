# STYLE-DIFF

| 页面 | 差异点 | 原因 | 状态 |
|---|---|---|---|
| 血糖首页 | 已生成 `docs/screenshots/web-home.png`，未做像素 diff | 当前已移植原型 CSS 和 DOM 主结构，仍需与原型截图自动比对 | 未完成 |
| 录入弹层 | 待 Playwright 像素比对 | 多指标 React 版本已复用类名，血糖弹层仍需逐像素收敛 | 未完成 |
| B 端后台 | 已生成 `docs/screenshots/console-dashboard.png`，数据内容不同 | 真实 API 数据替代原型内存数据 | 可接受 |

tokens.css 与原型 `:root` 由 `scripts/extract-styles.mjs` 自动校验。
