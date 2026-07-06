# SELF-CHECK

## A · 血糖像素

- [x] A1 手机框架 390×844 双圆角与深绿桌面
- [x] A2 假状态栏+微信胶囊
- [x] A3 TabBar 中央水滴按钮上浮 26px
- [x] A4 hero 渐变/54px 大数字/gauge 目标带与圆点
- [x] A5 录入键盘沿用 `.sheet/.keypad/.key.save` 原型类与提取 CSS
- [x] A6 安全提醒 M1/M2/M8/M9/M10 按保存响应延迟弹出
- [x] A7 血糖单位切换 E2E 覆盖，mg/dL/mmol 自动换算
- [x] A8 目标带/大数字/五态颜色使用 shared 判定与原型 token
- [x] A9 统计趋势与周报入口可用
- [x] A10 自动视觉 diff 已建立；血糖首页与录入弹层 changedRatio=0，changedPixels=0（见 `docs/STYLE-DIFF.md`）

## B · 多指标 C 端

- [x] B1 首页四卡顺序/识别色眉行/五态数值色
- [x] B2 录入弹层指标 seg 四面板切换
- [x] B3 血脂至少一项校验与逐项五态圆点
- [x] B4 尿酸性别阈值随「我的」性别切换
- [x] B5 历史页一级指标 seg
- [x] B6 周报 `/api/app/report/weekly` + C 端周报子页已实现
- [x] B7 单指标 CSV / 全部 ZIP 导出已实现并有 API/E2E 覆盖
- [x] B8 回收站列表与恢复已实现；历史删除进入软删除

## C · 药房后台

- [x] C1 侧栏布局/角色菜单差异
- [x] C2 工作台统计与列表
- [x] C3 客户列表 StatusDot 与筛选
- [x] C5 预警中心标记跟进
- [x] C6 生成邀请码和真实二维码
- [x] C7 员工新增、停用、启用 UI + API 测试
- [x] C8 admin 基础药房管理
- [x] C4 客户详情已展示指标概览与趋势面板，并调用 `/stats` 同一统计服务

## D · 合规与隔离

- [x] D1 绑定必经 M6 授权弹窗
- [x] D2 解绑后药房详情 403
- [x] D4 B 端客户页 F10、邀请页 F11
- [x] D5 AccessLog 在查看客户详情时落库
- [x] D6 安全提醒触发线由 shared/API 测试覆盖
- [x] D3 文案扫描完成：仅剩标准免责声明「不提供诊断与用药建议」

## 验证摘要

- `pnpm --filter @tangji/shared test`：79 tests passed
- `pnpm --filter @tangji/api test`：18 tests passed
- `pnpm --filter @tangji/web build`：passed
- `pnpm --filter @tangji/console build`：passed
- `pnpm e2e`：7 tests passed
- `node scripts/visual-diff.mjs`：生成 `prototype-glucose-home.png` / `app-glucose-home.png` / `diff-glucose-home.png` / `prototype-glucose-sheet.png` / `app-glucose-sheet.png` / `diff-glucose-sheet.png`；当前血糖首页与录入弹层差异率均为 0%
