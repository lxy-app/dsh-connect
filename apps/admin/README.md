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
| `/overview` | 设备在线/离线、账号统计、最近 8 条审计 |
| `/users` | 用户列表、创建、改名/改角色/重置密码、启用禁用、删除 |
| `/devices` | 设备列表、详情（授权工作区/scope/指纹）、改名、吊销、删除 |
| `/pairing` | 生成一次性桌面配对码（明文只显示一次）、查看最近配对码状态 |
| `/mobile` | 按用户生成手机配对二维码、复制配对码/链接、查看和吊销手机 |
| `/audit` | 审计日志，支持动作/操作者/结果/时间范围过滤与分页 |

## 手机配对

`/mobile` 使用本地 `qrcode.react` 渲染二维码，不依赖外部二维码服务：

1. 选择要绑定的用户。
2. 生成一次性手机配对码。
3. 让用户在 DSH Connect App 内扫描二维码，或手动输入 Server 地址与配对码。
4. 二维码含一次性凭据，页面只显示当前生成结果，不提供历史明文回读。

Server 返回的 `serverUrl` 必须能被手机访问。若页面提示回环地址或 `0.0.0.0` 不可达，请在 Server 配置中将 `DSH_CONNECT_SERVER_URL` 改为局域网 IP 或 HTTPS 域名后重启并重新生成。

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
make test-admin      # tsc --noEmit
```