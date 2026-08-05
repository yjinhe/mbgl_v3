# 糖迹项目当前进度

> 最后更新：2026-08-06（Asia/Shanghai）
> 继续开发分支：`codex/wechat-personal-release`

## 1. 当前产品策略

- 手机 Web 是普通用户的主要入口，支持注册、密码登录、微信网页登录和四类健康数据记录。
- 微信小程序单独维护为“个人健康数据记录工具”，不在可上传代码中提供药房、售药、问诊、诊断、治疗或个性化处置功能。
- 后端和手机 Web 中的现有管理功能暂时保留，本分支只收缩小程序对外界面。
- 生产环境已有真实用户持续录入数据，不得执行生产 `seed`、`docker compose down -v` 或未备份的数据库替换。

## 2. 生产与备案状态

- 普通用户地址：<https://tangji.aiteam.pw>
- 健康检查：<https://tangji.aiteam.pw/health>
- ECS：`8.152.100.100`，部署目录为 `/opt/tangji-v3-deploy`。
- ICP 备案已通过：`京ICP备2026047601号-1`。备案号已展示在用户网页底部并链接到工信部备案系统。
- HTTP 会跳转 HTTPS，公网 HTTPS 和 API 健康检查已恢复。
- 当前生产前端版本：`cca776628c21ae15c149d517fe41b47a85017bdf`。
- 当前生产 API 版本：`7b3e5d0454b7fcd0e3eee28575d7635d358f6429`。两者之间只差网页备案号展示，API 无需同步重建。
- 2026-08-05 发布前备份：`/root/tangji-backups/tangji-20260805T152612Z.tar.gz`。

## 3. 本分支已完成的小程序调整

小程序目录：`apps/wechat-miniprogram`

- 移除小程序内的药房绑定页面和入口。
- 新增《用户协议》和《隐私政策》常驻页面。
- 登录前要求用户主动勾选协议，并接入微信隐私授权接口。
- 新增全部记录 ZIP 导出和微信文件分享。
- 保留四类数据记录、历史、统计、回收站、退出和注销账号。
- 将越界的诊疗或用药表述改为中性数值提醒。
- 开启小程序合法域名校验和隐私检查。
- 上传包已排除 `test`、`README.md` 和 `package.json`。
- 生产 API 基址仍为 `https://tangji.aiteam.pw`。

## 4. 已完成的本地校验

- `apps/wechat-miniprogram`：2 个测试文件、15 项测试全部通过。
- 全部小程序 JavaScript 文件已通过 `node --check`。
- 可上传源码中的药房、用药、诊疗建议等关键表述扫描通过。
- `git diff --check` 通过。
- 尚未在微信开发者工具中完成真机预览和体验版验收。

## 5. 下一步必做事项

1. 在微信公众平台完成小程序备案。网站 ICP 备案通过不等于小程序备案或代码审核通过。
2. 在微信公众平台确认实际可选的服务类目，并保持类目、备案服务内容、页面文案和审核说明一致。
3. 将 `https://tangji.aiteam.pw` 同时配置为 `request` 和 `downloadFile` 合法域名。
4. 在“用户隐私保护指引”如实声明微信账号标识、性别和用户主动填写的健康记录数据。
5. 核对运营主体、开发者联系方式、平台隐私指引与小程序内《隐私政策》完全一致。
6. 用微信开发者工具导入 `apps/wechat-miniprogram`，真机验证：协议勾选、微信登录、四类记录、导出分享、回收站和账号注销。
7. 上传体验版，逐页检查后提交微信代码审核。

## 6. 在另一台电脑继续

```bash
git clone git@github.com:yjinhe/mbgl_v3.git
cd mbgl_v3
git fetch origin
git switch --track origin/codex/wechat-personal-release
corepack prepare pnpm@10.33.1 --activate
pnpm install --frozen-lockfile
pnpm --filter @tangji/wechat-miniprogram test
```

然后用微信开发者工具导入：

```text
apps/wechat-miniprogram
```

若本地已有仓库，不要重新克隆，只需在确认本地改动已保存后执行 `git fetch origin`，再切换或合并该分支。

## 7. 安全与运维注意事项

- 不要将 `.env.docker`、微信 AppSecret、JWT 密钥、SSH 私钥、数据库或备份包提交到 Git。
- 生产发布前先运行备份，并保留上一版镜像。
- 生产数据库中同时存在演示数据和真实用户数据，清理前必须人工确认身份和备份，不能批量删除。
- 用户健康数据属于敏感个人信息，排查问题时优先使用汇总结果，不在文档、日志或提交中写入用户明细。
- 服务器全量构建可能因 Debian 软件源较慢而卡在 API 基础镜像的 `apt-get update`。只修改前端时可仅构建和切换 `tangji-frontends`，但仍需先备份并在发布后检查前端容器、`/build.json` 和 `/health`。
