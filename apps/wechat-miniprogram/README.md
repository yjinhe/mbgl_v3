# 糖迹微信小程序端

这是 C 端的原生微信小程序版本，可直接用微信开发者工具打开本目录。

当前实现按 Web C 端做视觉还原：关闭原生导航栏与原生 tabBar，使用 `screen/safe-navbar/pages/tabbar/fab/sheet/keypad` 结构承载页面。真实小程序环境自带状态栏和右上角胶囊，因此不再绘制 Web 原型里的假状态栏、假胶囊，避免和微信容器重叠。

## 本地运行

1. 先在仓库根目录启动后端：

   ```bash
   corepack pnpm dev
   ```

2. 用微信开发者工具导入：

   ```text
   apps/wechat-miniprogram
   ```

3. 默认 API 地址在 `app.js`：

   ```js
   apiBase: 'https://tangji.aiteam.pw'
   ```

   小程序体验版/正式版需要在微信公众平台把该域名添加到合法域名。若改回本地联调，真机预览时请使用电脑局域网 IP，并在开发者工具中关闭合法域名校验；手机上的 `127.0.0.1` 指的是手机自己，不是这台电脑。

4. API 生产环境必须设置 `WECHAT_MOCK=false`、`WECHAT_APPID` 和 `WECHAT_SECRET`。后端会通过微信 `jscode2session` 将临时登录 code 换成稳定 openid。

## 已接入流程

- 微信一键登录
- 首页四指标总览
- 血糖、血压、血脂、尿酸记录
- 历史记录与软删除
- 统计摘要
- 我的页、性别/血糖单位切换
- 服务药房绑定/解绑
- 回收站恢复

## 还原优先级

- 首页、底部 Tab、录入 sheet/keypad 优先按 Web C 端结构和视觉还原。
- 历史、统计、我的页已切换为同款自定义壳和组件语言，后续可继续按 Web 页面逐段补齐细节。
- 小程序限制下无法直接复用 DOM/CSS/SVG，样式已按 Web `mobile.css` 翻译为 WXSS/rpx。
