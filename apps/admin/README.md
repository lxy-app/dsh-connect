# DSH Connect Web Admin

React 19 + Ant Design 6 + Vite 8 的管理后台，直接对接 Go Server 的 `/v1/admin` API。

## 开发

```sh
# 1. 先起后端
make db-up
make run-server

# 2. 安装依赖并启动前端
make admin-install
make run-admin      # http://127.0.0.1:5173
```

Vite 开发服务器把 `/v1` 代理到 `http://127.0.0.1:8787`（可用 `DSH_CONNECT_SERVER_URL` 覆盖目标），因此浏览器看到的是同源请求，开发期不需要 CORS。直接访问后端时 Server 也已按 `DSH_CONNECT_ADMIN_ORIGIN`（默认仅 loopback）放行 CORS。

登录账号来自 Server 的 Owner 引导，即 `.env` 里的 `DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL` / `DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD`。

## 页面

| 路由 | 功能 |
|---|---|
| `/overview` | 在线桌面、活跃会话、今日指令、待处理交互、7 日趋势、最近会话与审计；支持手动刷新 |
| `/users` | 用户列表、创建、改名/改角色/重置密码、启用禁用、删除 |
| `/devices` | 桌面/手机 Tab；桌面详情、改名、吊销、删除；添加桌面向导与配对记录；手机二维码配对与吊销 |
| `/pairing` | 兼容旧深链，重定向到 `/devices` |
| `/mobile` | 兼容旧深链，重定向到 `/devices?tab=mobile` |
| `/policies` | 访问策略 CRUD、启停、成员关联、按桌面×工作区×scope 配置与 revision 冲突处理 |
| `/running` | 只读会话元数据，按设备、状态、工作区筛选；单桌面异常以 warning 展示 |
| `/audit` | 审计日志，支持动作/操作者/结果/时间范围过滤与分页；策略变更可展开 before/after 差异 |

## 桌面配对

在 `/devices` 的“桌面 Connector”页点击“添加桌面”：

1. 生成一次性配对码，明文仅保留在当前向导中，关闭后清除且不能回读。
2. 在目标桌面的 Connector 面板中输入 Server 地址与配对码。
3. 向导按稳定 `pairingId` 每 2 秒读取状态，依次展示等待 Connector、等待桌面授权和设备上线。
4. 桌面明确确认指纹、工作区和 scopes 后才完成；接入桌面不会隐式授予手机权限。

## 手机配对

`/devices?tab=mobile` 使用本地 `qrcode.react` 渲染二维码，不依赖外部二维码服务：

1. 选择要绑定的用户。
2. 生成一次性手机配对码。
3. 让用户在 DSH Connect App 内扫描二维码，或手动输入 Server 地址与配对码。
4. 二维码含一次性凭据，页面只显示当前生成结果，不提供历史明文回读。

Server 返回的 `serverUrl` 必须能被手机访问。若页面提示回环地址或 `0.0.0.0` 不可达，请在 Server 配置中将 `DSH_CONNECT_SERVER_URL` 改为局域网 IP 或 HTTPS 域名后重启并重新生成。

## 访问策略与用户预览

`/policies` 按“成员 → 桌面 → 工作区 → read/prompt/cancel/approve”配置真实权限。多个启用策略按工作区求并集，无策略默认拒绝；手机 active grant 和桌面当前授权仍会进一步收窄结果。

用户与角色页可查看关联策略并打开 Server 计算的策略预览。预览只表示策略允许范围，不代表某台手机已经获得 grant；实际控制仍需桌面单独确认。

## 运行会话与指标口径

`/running` 只展示 Connector 经 `session.list` 返回的 sessionId、标题、桌面、工作区、running/idle 状态和更新时间，不读取正文，也不提供取消或审批操作。单桌面离线、超时或协议异常不会阻塞其他桌面，页面会标明当前为部分快照。

概览中的“今日指令”和近 7 日趋势按幂等记录中的唯一 `session.prompt` 准入计算，即 Connector 已成功响应的请求；同一 requestId 重试不重复计数，未提交请求不计入，也不代表 Turn 已完成。日期桶使用浏览器提供的 IANA 时区，默认 UTC。

## 权限模型

前端只做体验层隐藏，真正的权限由 Server 强制：

- `owner`：全部操作，含角色变更、启用禁用、删除用户；必须保留至少一位 active Owner。
- `admin`：可创建/编辑非 Owner 账号资料、重置其密码、管理设备；不能修改 Owner 资料或凭据、不能改角色、不能创建 Owner。
- `auditor`：只读概览、用户、设备、配对状态与审计。
- `member`：仅保留本人身份，不加载全局概览、用户、设备、配对或审计页面。

手机设备页：owner/admin 可生成配对码并吊销手机；auditor 只读；member 无权访问该页面。后端同样强制这些权限。Member 本人自助配对 API 的既有能力不变，但当前 Web Admin 不提供对应页面。

## 认证

登录返回的 session token 存在 `localStorage`（key `dsh-connect.admin.session`），随 `Authorization: Bearer` 发送。任何 401 都会清空会话并回到登录页。生产环境请使用 HTTPS。

## 构建

```sh
make admin-build     # 产出 apps/admin/dist
```

构建产物是纯静态文件，可交给任意静态服务器或反向代理；需把 `/v1` 反向代理到 Go Server，并对 SPA 路由做 fallback 到 `index.html`。

页面按路由 `React.lazy` 分包，首屏只加载登录页与共享依赖。注意：不要给 antd/rc 配置手动 vendor 分组或 `maxSize` 切包——rolldown 会产生 chunk 循环依赖（`Cannot destructure property 'Title' ... undefined`），生产构建直接白屏。共享 chunk 的划分交给 rolldown 默认算法。

本地验证生产包：`make run-server` 后执行 `npx vite preview`（端口 4173，`/v1` 代理与开发一致）。

## 检查

```sh
make test-admin           # TypeScript + Vitest 组件测试
make test-admin-e2e       # Playwright Chromium 浏览器测试
```

首次运行浏览器测试前安装匹配版本的 Chromium：

```sh
cd apps/admin
npx playwright install chromium
```

已有系统 Chrome 时也可执行 `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`，无需下载独立 Chromium。

浏览器测试由 Playwright 启动 Vite，并通过 `page.route` 模拟 Admin API，覆盖设备 Tab、旧深链、配对状态轮询和 Member 路由拦截；不连接真实 Server。真实权限与协议行为由 Go Server 集成测试及跨端 E2E 验证。