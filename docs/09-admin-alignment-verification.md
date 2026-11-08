# Web Admin 对齐升级与验证指南

本文覆盖 Admin 对齐工作的 M0–M5 工程边界、升级注意事项和验证命令。原型仍是独立模拟页面，不能替代真实 Server、Connector 或浏览器验证。

## 1. 功能边界

| 批次 | 真实工程范围 |
|---|---|
| M0 | Admin RBAC、Admin 禁止修改 Owner、最后 active Owner 事务保护、移动 WSS 吊销与失效收紧 |
| M1 | Admin OpenAPI、设备桌面/手机 Tab、稳定 pairingId、真实配对向导、组件与浏览器测试基线 |
| M2 | 访问策略 CRUD、用户预览、默认拒绝、策略/grant/桌面交集、全链路收紧、revision 与 before/after 审计 |
| M3 | 只读会话元数据、真实概览指标、唯一 prompt 准入趋势、IANA 时区和部分快照 warning |
| M4 | 只读审批核对、远程审批开关与 TTL、运行时只读设置；不包含 Admin 审批决定 |
| M5 | 明暗主题、正式应用图标、响应式、完整回归与升级/回退说明 |

## 2. 升级注意事项

### 访问策略

M2 后，手机不再仅凭已有 active grant 获得访问。有效权限为：

```text
用户所有启用策略按工作区求并集
∩ 手机 active grant
∩ 桌面当前开放的工作区与 scopes
```

升级后需要 Owner/Admin 为用户配置访问策略。无策略或策略被停用时不返回可见桌面；已有 grant 不构成绕过。策略启停、成员或规则变化会关闭相关手机的既有事件流，客户端按恢复流程重新鉴权。

### 审批策略

M4 的远程审批策略由 Server 持久化，包含 `remoteEnabled`、`ttlSeconds` 和 `revision`。TTL 上限为 10 分钟；缩短 TTL 时，现有待处理项按新规则收紧。关闭远程审批不会伪造批准，也不会删除桌面原生审批链。

生物识别、APNs/FCM 和其他未接入能力不得在 Admin 中显示为已生效。部署凭据继续由环境变量或秘密管理设施提供，不进入 Admin API。

### 数据库迁移

新增 schema 由 Server 启动时的 ent 迁移创建。升级前按数据库类型执行既有备份流程；SQLite 使用 Online Backup API 或 `VACUUM INTO`，不要直接复制可能仍有 WAL 的数据库文件。PostgreSQL 使用既有备份与恢复流程。

## 3. 回退边界

- 新增表和列属于加法式迁移，但不能据此认定所有旧二进制都安全。
- **回退到不包含访问策略强制的版本会改变安全边界。** 必须暂停移动控制或经过单独的安全评审，不能把数据库可打开等同于业务安全回退。
- 回退到不包含审批策略的版本会恢复该版本的固定审批行为；不得假设新的动态 TTL/开关仍然生效。
- 任何回退都不能删除 DSH 本地会话。会话事实源仍是 Connector 通过 Host API 获取的 Session Log。

## 4. 验证命令

```sh
# Server：同一套用例分别跑 PostgreSQL 和 SQLite
DSH_CONNECT_REQUIRE_PG=1 make test-server

# Go 静态检查
make vet

# Admin：TypeScript + Vitest
make test-admin

# Admin：独立 Chromium/Chrome 浏览器测试
cd apps/admin && npx playwright install chromium   # 首次需要
make test-admin-e2e                                # 从仓库根目录执行
# 已有系统 Chrome 时：
PLAYWRIGHT_CHANNEL=chrome make test-admin-e2e

# Connector + Server 可控 Host 仿真，分别跑 PostgreSQL/SQLite
DSH_CONNECT_REQUIRE_PG=1 make test-e2e

# Admin 生产构建
make admin-build
```

浏览器测试通过 `page.route` 模拟 Admin API，验证真实浏览器中的导航、表单、状态和错误反馈；不连接真实 Server。Server 权限与协议由 Go 测试验证，Connector E2E 使用可控 Host 仿真。

## 5. 发布前仍需单独验收

- 真实 DSH 插件安装、启动、启停、升级、卸载与回退。
- 真实 Agent 执行、审批、取消和事件恢复。
- 移动真机生物识别、通知和原生能力（若后续接入）。
- 实际部署环境的备份恢复、升级和回退演练。

静态检查、组件测试、浏览器 mock 和可控 Host E2E 均不能替代上述验收。
