# DSH Connect Server

单实例 Go 中继 Server。它只通过 Connector 调用 `session.*` 方法并中继事件，**不读取 DSH 文件、不直接调用 DSH Service，也不保存会话正文**。

持久层为 **PostgreSQL 18（默认）或 SQLite + ent ORM**：配对码、设备凭据 hash、create/prompt/model.select 幂等结果、审计、管理账号与浏览器会话、手机设备与移动令牌、手机访问授权。所有密钥只以 SHA-256 存储。两种数据库共用同一套 ent schema 和 Store 业务代码，由 `DSH_CONNECT_DATABASE_URL` 的 scheme 选择。

## 运行

要求 Go 1.26+。默认使用 PostgreSQL 18；单实例可选择 SQLite，无需独立数据库服务。

```sh
# 1. PostgreSQL 默认路径：起数据库（docker-compose，数据卷持久化）
#    SQLite 路径无需执行此步
make db-up

# 2. 配置
cp .env.example .env   # 填入 DSH_CONNECT_BOOTSTRAP_TOKEN 与 Owner 账号

# 3. 启动；首次运行自动迁移建表并创建 Owner
make run-server
```

默认监听 `127.0.0.1:8787`。启动时通过 ent 集成的 Atlas 执行 schema 自动迁移（不启用主动删列/删索引选项），并把残留的 `online` 设备置为 `offline`。

SQLite 使用文件路径形式的 URL。先在 `.env` 中配置，再照常执行 `make run-server`：

```dotenv
# 相对路径以 Server 工作目录为基准；父目录必须已存在。
DSH_CONNECT_DATABASE_URL=sqlite://./data/dsh-connect.db
```

绝对路径使用三个斜杠，例如 `sqlite:///data/sqlite/dsh-connect.db`。SQLite 连接固定启用 WAL、5 秒 busy timeout、外键检查和 `synchronous=FULL`，Server 内使用单连接避免写事务升级竞争。

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DSH_CONNECT_BOOTSTRAP_TOKEN` | 无，必填 | 管理/调试 REST+WSS 的 Bearer |
| `DSH_CONNECT_DATABASE_URL` | `postgres://dsh:dsh@127.0.0.1:5432/dsh_connect?sslmode=disable` | `postgres://` / `postgresql://` 或 `sqlite://`；未知 scheme 拒绝启动 |
| `DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL` | 空 | 首次启动创建的 Owner 邮箱 |
| `DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD` | 空 | Owner 初始密码（≥8 位） |
| `DSH_CONNECT_BOOTSTRAP_OWNER_NAME` | `Owner` | Owner 显示名 |
| `DSH_CONNECT_ADMIN_ORIGIN` | 空（仅 loopback） | 管理后台允许的 CORS origin，逗号分隔；同源部署无需设置 |
| `DSH_CONNECT_ADMIN_DIR` | 空 | 可选的 Admin 构建产物目录；设置后同源托管静态文件与 SPA 路由 |
| `DSH_CONNECT_MOBILE_PAIRING_TTL` | `5m` | 手机一次性配对码有效期，Go duration |
| `DSH_CONNECT_MOBILE_ACCESS_TTL` | `15m` | 手机 Access Token 有效期，Go duration |
| `DSH_CONNECT_MOBILE_REFRESH_TTL` | `720h` | 手机 Refresh Token 有效期，Go duration |
| `DSH_CONNECT_LISTEN_ADDR` | `127.0.0.1:8787` | HTTP 监听地址 |
| `DSH_CONNECT_SERVER_URL` | 按监听地址推导 | 配对码响应中的外部 URL |
| `DSH_CONNECT_TLS_CERT_FILE` / `_KEY_FILE` | 空 | 同时设置后对外为 https/wss |

Owner 引导是幂等的：只在 `users` 表为空时创建，已有账号不会被覆盖或重置密码。

### SQLite 单实例边界

- 仅支持单个 Server 实例和本机磁盘；不要让多个副本共享数据库文件，也不要把 WAL 数据库放在 NFS 等网络文件系统上。高并发写入或多实例部署继续使用 PostgreSQL。
- Docker 使用 `sqlite:///data/sqlite/dsh-connect.db` 时必须持久化 `/data/sqlite`；附件字节仍单独持久化 `/data/attachments`。
- 运行中备份使用 SQLite Online Backup API 或 `VACUUM INTO`，不要直接复制可能尚未包含 WAL 内容的主 DB 文件。停止 Server 后备份则应包含仍然存在的 `-wal` 文件。
- ent 的 SQLite 迁移可能通过临时表完成列修改，因此 schema 升级测试必须覆盖旧版本数据库，不能只验证全新建库。
- 当前不提供 PostgreSQL ↔ SQLite 自动数据迁移、双写或同步；切换已有部署需要单独的导出/导入与回滚验证。

## 管理后台 API

管理接口接受两种凭据：

1. `Authorization: Bearer $DSH_CONNECT_BOOTSTRAP_TOKEN` —— 自动化/调试，等价 Owner。
2. `Authorization: Bearer <登录返回的 session token>` —— Web 管理后台。

登录会话令牌同样只存 SHA-256；默认有效期 12 小时，退出即吊销。

| 方法 | 路径 | 最低角色 | 行为 |
|---|---|---|---|
| POST | `/v1/admin/auth/login` | 无 | 邮箱密码登录，返回 `token/expiresAt/user` |
| POST | `/v1/admin/auth/logout` | 已登录 | 吊销当前会话 |
| GET | `/v1/admin/auth/me` | 已登录 | 当前操作者 |
| GET | `/v1/admin/overview` | owner/admin/auditor | 设备/账号计数、活跃会话、prompt 准入趋势、待处理交互与最近 8 条审计；可选 IANA `tz` |
| GET | `/v1/admin/sessions` | owner/admin/auditor | 并发聚合桌面会话元数据与部分失败 warning，不含正文或路径 |
| GET | `/v1/admin/users` | owner/admin/auditor | 用户列表 |
| POST | `/v1/admin/users` | owner/admin | 创建用户（仅 owner 可建 owner） |
| PATCH | `/v1/admin/users/{id}` | owner/admin | 改非 Owner 账号显示名/密码；角色与状态仅 owner；admin 不能修改 owner |
| DELETE | `/v1/admin/users/{id}` | owner | 删除用户并撤销其会话 |
| GET | `/v1/admin/devices` | owner/admin/auditor | 设备列表（含 `hasToken`） |
| PATCH | `/v1/admin/devices/{id}` | owner/admin | 重命名设备 |
| POST | `/v1/admin/devices/{id}/revoke` | owner/admin | 吊销凭据并断开在线 Connector |
| DELETE | `/v1/admin/devices/{id}` | owner/admin | 删除设备记录 |
| GET | `/v1/admin/audit` | owner/admin/auditor | 审计查询：`action/actor/deviceId/result/from/to/limit/offset` |
| POST | `/v1/admin/pairing-codes` | owner/admin | 生成一次性桌面配对码，返回稳定 `pairingId`；明文仅返回一次 |
| GET | `/v1/admin/pairing-codes` | owner/admin/auditor | 最近 20 个配对码的 `pairingId` 与生命周期状态 |
| POST | `/v1/admin/mobile/pairing-codes` | 已登录 | 为用户生成手机配对码；bootstrap 必须显式传 `userId`，成员只能为自己生成 |
| GET | `/v1/admin/mobile-devices` | owner/admin/auditor | 手机设备列表，永不返回令牌 |
| POST | `/v1/admin/mobile-devices/{id}/revoke` | owner/admin | 吊销手机及其访问/刷新令牌 |
| GET/POST | `/v1/admin/policies` | 读含 auditor；写 owner/admin | 访问策略列表/创建 |
| PATCH/DELETE | `/v1/admin/policies/{id}` | owner/admin | 按 revision 更新/删除策略，冲突返回 `conflict` |
| GET | `/v1/admin/users/{id}/access-preview` | owner/admin/auditor | 按用户预览策略可见桌面、工作区和 scopes，不含路径 |

安全约束：

- 最后一位 **active** Owner 不能被降级、禁用或删除（返回 `conflict`）。Store 在事务内锁定 active Owner 集合并完成检查与写入，避免并发请求同时移除不同 Owner；删除用户及其依赖清理也在同一事务内完成。
- Admin 只能维护非 Owner 账号；Owner 的显示名、角色、状态和密码只能由 Owner 修改，防止通过重置 Owner 密码提权。
- Member 不能通过概览或设备列表读取全局账号、审计、工作区路径或设备指纹。
- 手机有效权限为“用户所有启用策略按工作区求并集 ∩ 手机 active grant ∩ 桌面当前工作区/scopes”。无策略默认拒绝，已有 grant 不绕过策略；策略、桌面授权或 grant 收窄会关闭相关移动事件流并要求重新鉴权。
- 策略更新和删除使用 revision 乐观锁；策略创建、更新、删除审计的 `details` 记录 before/after 策略内容，不包含密码、Token 或会话正文。
- 登录失败对“邮箱不存在”和“密码错误”返回同一响应，且都会写审计，便于发现暴力破解。
- 已吊销设备不会被断线回调改写回 `offline`（`revoked` 是终态）。
- 配对码属于授权动作，只有 owner/admin 能生成；列表只暴露 `active/used/expired` 状态，明文码不可回读。
- `/v1/pairing/desktop-codes` 与 `/v1/admin/pairing-codes` 共用同一实现，因此两者行为一致。

## P0 会话 API（不变）

以下接口只接受 bootstrap token：

| 方法/通道 | 路径 | 行为 |
|---|---|---|
| POST | `/v1/pairing/desktop-codes` | 创建一次性 10 分钟配对码 |
| GET | `/v1/devices` | 公开设备 DTO（不含令牌/hash） |
| GET | `/v1/sessions?deviceId&workspaceId&timeoutMs` | 路由 `session.list` |
| POST | `/v1/sessions` | 路由 `session.create` |
| GET | `/v1/sessions/{id}/page?deviceId&cursor&limit` | 路由 `session.page`，limit 1–200 |
| POST | `/v1/sessions/{id}/prompt` | 路由 `session.prompt` |
| POST | `/v1/sessions/{id}/cancel` | 路由 `session.cancel` |
| GET WS | `/v1/events/ws` | follow 并中继事件 |
| GET WS | `/v1/connector/ws` | Connector 配对、认证、命令/事件单连接（唯一免管理鉴权通道） |

Connector 配对链路会向 stderr 输出 `connector connected`、`pair.start received/waiting_desktop_authorization`、`pair.authorize received/completed` 及错误码日志。日志只包含 requestId、deviceId、数量与错误等白名单字段，不记录配对码、token/hash、Authorization、原始帧或工作区路径。配对数据库操作受 `CommandTimeout`（默认 15 秒）约束，内部错误返回 `internal_error`，不会误报为配对码无效。

`session.create`、`session.prompt` 与 `session.model.select` 的 `requestId` 都是持久幂等键，由数据库唯一约束保证：并发重复等待同一执行，完成后的重复直接读取首次结果，不同 method/device/params 复用同一 key 返回 `idempotency_conflict`。不同命令必须使用不同 requestId；模型选择的 sessionId/workspaceId/provider/model/reasoningEffort 都进入请求哈希。

Admin 概览的 prompt 指标只统计幂等表中 `method=session.prompt`、无错误且已完成准入的唯一记录；同一 requestId 重试不重复计数，未提交的离线请求不落记录。该指标表示 Connector 成功响应的唯一 prompt 准入数，不表示 Turn 已完成。

## 手机配对 API

手机使用独立的设备身份和令牌，不共享桌面 Connector 凭据。Web 管理后台的 **手机配对** 页面（`/mobile`）负责选择用户、生成二维码并吊销手机：

| 方法/通道 | 路径 | 行为 |
|---|---|---|
| POST | `/v1/admin/mobile/pairing-codes` | 生成短时一次性配对码与 `dshconnect://` 二维码链接 |
| POST | `/v1/mobile/pair` | 无 Bearer 鉴权；用一次性码兑换手机身份与令牌 |
| POST | `/v1/mobile/auth/refresh` | 原子轮换 Access/Refresh Token，旧 refresh 立即失效 |
| POST | `/v1/mobile/auth/logout` | 使用手机 Access Token 吊销当前手机 |
| GET | `/v1/mobile/me` | 返回当前手机与所属用户 |
| GET | `/v1/mobile/access` | 桌面、桌面已开放的工作区/动作，以及本机 grant 状态 |
| POST | `/v1/mobile/access/requests` | 申请工作区/动作子集，默认 `pending` |
| DELETE | `/v1/mobile/access/{grantId}` | 手机撤销自己的申请或授权 |
| GET | `/v1/mobile/workspaces` | 仅 active grant 中的工作区 |
| GET | `/v1/mobile/sessions` | 聚合授权桌面会话；离线桌面返回 warning |
| POST | `/v1/mobile/sessions` | 创建会话，需 `prompt`，沿用独立 requestId 幂等 |
| GET | `/v1/mobile/sessions/{id}/messages` | 稳定 transcript，需 `read`；WSS 断开时的兜底 |
| GET | `/v1/mobile/sessions/{id}/model` | 当前会话模型与可用目录，需 `read`；不激活冷 Agent |
| POST | `/v1/mobile/sessions/{id}/model` | 只切换当前会话模型，需 `prompt`，沿用独立 requestId 持久幂等 |
| GET | `/v1/mobile/events/ws` | 需 `read` grant；compact follow 并只推送 assistant 增量/对话/模型选择事件 |
| POST | `/v1/mobile/sessions/{id}/prompt` | 发送提示词，需 `prompt`，沿用 requestId 幂等 |
| POST | `/v1/mobile/sessions/{id}/cancel` | 取消当前 Turn，需 `cancel` |
| GET | `/v1/mobile/interactions` | 本机可回答的待处理审批/提问，需 `approve`；按设备/会话过滤 |
| POST | `/v1/mobile/interactions/{id}/decision` | 一次性提交 `allow-once`/`reject` 或 question answers，转发给 Connector |
| GET | `/v1/admin/mobile-devices` | 手机设备管理列表 |
| POST | `/v1/admin/mobile-devices/{id}/revoke` | 管理员吊销手机 |

安全约束：

- 配对码、Access Token、Refresh Token 的明文都只返回一次，数据库只保存 SHA-256 hash。
- 配对目标用户从配对码记录读取，手机请求不能指定 `userId`。
- 手机被禁用、吊销或 refresh 已过期时，`/v1/mobile/me` 与 refresh 都失败关闭。
- 手机配对不代表获得桌面权限。`GET /v1/mobile/access` 先展示桌面已开放范围；手机只能申请其子集，grant 默认 `pending`。
- 只有桌面 Connector 通过已认证 WSS 的 `mobile.access.list` / `mobile.access.decide` 才能批准、拒绝或撤销 grant。Server 不代替桌面做授权决定。
- `pair.updateGrants` 允许桌面 Connector 在面板显式确认后更新自己的 workspace/scope（例如追加 `approve`），无需重新配对；Server 校验动作词汇并写审计 `pair.grants.update`，手机 grant 仍需单独申请和桌面确认。
- 会话列表、create、transcript、模型读取/选择、prompt、cancel、interactions 每次都校验 grant（设备 + 工作区 + scope）；Connector 再校验工作区授权、会话真实归属或审批答案，形成双重 fail-closed。
- 待处理审批只存在内存中，Server 重启或 Connector 断连即清空；同一 interaction 在 Server 内用 CAS 预留，避免两台手机重复消费。
- 手机 logout、管理员吊销手机、桌面吊销都会撤销相关 grant。
- 手机 logout、管理员吊销手机、手机或桌面撤销 grant、用户被禁用或删除时，Server 会关闭该手机/用户已建立的 `/v1/mobile/events/ws`。事件订阅登记后会重新读取当前手机、用户和 grant 状态，避免旧握手身份在吊销竞态中继续建立连接。
- **移动 Access Token 不能访问 `/v1/devices`、`/v1/sessions` 或 `/v1/events/ws` 等调试接口。** 移动端仅使用受 grant 约束的 `/v1/mobile/*` API；`/v1/mobile/events/ws` 先校验 grant，再以 compact follow 推送 assistant 增量，原始工具 payload 由 Server 过滤。

## 移动端附件

会话中"交付/返回"的文件由 Connector 声明（不含路径、不含字节），随 transcript 下发；手机点开时再由 Connector 按桌面侧校验读盘并上传，手机通过独立 HTTPS 端点取图。**路径永不出桌面，字节不进 WSS/JSON。**

| 端点 | 调用方 | 说明 |
|---|---|---|
| `GET /v1/mobile/attachments/{attachmentId}` | App | `200` 字节（带 `ETag`，支持 `If-None-Match` → `304`）；`202` 正在拉取（`Retry-After`）；`409` 桌面侧失败（带 `errorCode`）；`403` grant 失效；`404` 未知/过期；`413` 超限 |
| `POST /v1/connector/attachments/{attachmentId}` | Connector | `application/octet-stream`，device token 认证；`X-DSH-Attachment-{Session,Bytes,Sha256}` 必须与行内归属和 body 一致 |

实现要点：

- **学习式索引**：Server 在处理 `GET /v1/mobile/sessions/{id}/messages` 时把 Connector 返回的 `attachments` upsert 进 `session_attachments`；未被学习过的 id 一律 `404`，从源头阻断枚举。
- **反向授权**：下载端点只按行内记录的 device/workspace/session 校验 grant，不信任手机提交的任何归属参数。
- **状态由 Server 拥有**：Connector 只报 `known`，`fetching/ready/failed/unavailable` 与 `sha256` 由 Server 推进；`ready` 不会因新的 transcript 回落，传输/上传产生的 `failed` 也不会被普通轮询重置成 `known`，只有移动 GET 会显式触发重试。Server 启动时会把上一进程遗留的 `fetching` 恢复为 `known`，避免永久等待已消失的命令。
- **字节与元数据分离**：内容寻址写 `DSH_CONNECT_ATTACHMENT_DIR/<sha[0:2]>/<sha>`，DB 只存引用；上传先写临时文件再 rename，避免半成品。Docker 镜像默认使用可写的 `/data/attachments`，Compose 必须挂载 `dsh-connect-attachments` 持久卷。
- **就绪通知**：上传成功后向该 `(deviceId, sessionId)` 广播 `attachment.ready`（仅元数据），App 立即重载而不轮询。
- **失败关闭**：Connector 侧路径必须落在会话工作区内（默认拒绝工作区外交付）、拒绝 final symlink、命中敏感名单直接拒绝、并在读盘前重新 `stat` 比对基线，变化返回 `attachment_changed` 且不发送内容。

M1 已实现范围：交付图片在手机上以网格展示并可全屏缩放/翻页；非图片文件显示为信息行（下载/保存/打开属 M2）；手机上行为 M3。配置项见 `.env.example` 的 `DSH_CONNECT_ATTACHMENT*`（默认 `DSH_CONNECT_ATTACHMENTS=read`，单文件 20 MiB，blob 目录总量 2 GiB，blob TTL 168h）。

已知未实现：blob TTL 的定时回收任务（当前仅记录 TTL 配置，不主动删除过期 blob）；消息 `image`/`file` 内容块（M3）；手机上行的 `readwrite` 写入路径。

## 数据模型（ent schema）

| 表 | 用途 |
|---|---|
| `pairing_codes` | 一次性配对码 hash 与消费状态 |
| `devices` | 设备身份、授权工作区/scope、令牌 hash、在线状态 |
| `idempotency_records` | `session.create` / `session.prompt` / `session.model.select` 持久幂等结果 |
| `audit_entries` | 只追加审计，按 `occurred_at`/`device_id`/`action` 建索引；可选 details 保存策略 before/after |
| `access_policies` | 用户关联、启用状态、桌面×工作区×scope 规则与 revision |
| `users` | 管理账号（owner/admin/member/auditor） |
| `admin_sessions` | 浏览器登录会话 token hash |
| `mobile_pairing_codes` | 手机一次性配对码 hash、目标用户与消费状态 |
| `mobile_devices` | 手机身份、平台、Access/Refresh Token hash、过期与吊销状态 |
| `mobile_access_grants` | 手机—桌面—工作区/动作授权：`pending/active/denied/revoked` |
| `session_attachments` | 会话声明的文件元数据：归属、来源、状态、digest、过期时间（不含路径与字节） |
| `attachment_blobs` | 按 sha256 去重的 blob 索引，字节存 `DSH_CONNECT_ATTACHMENT_DIR` |

修改 schema 后重新生成：

```sh
make ent-gen
```

`make ent-gen` 里的生成器版本必须与 `server/go.mod` 中的 `entgo.io/ent` 保持一致；两处不一致会产出与运行时版本不匹配的代码。

目前 ent 依赖指向 master 快照 `v0.14.7-0.20261014065818-8037bc89bcab`（伪版本），因为正式版尚未包含 Go 1.27 支持：ent v0.14.6 的生成器使用 x/tools v0.51.0，无法解析 Go 1.27 的导出数据格式，在 Go 1.27 工具链下执行代码生成会报 `internal error: package "context" without types was imported`。上游修复见 [PR #4530](https://github.com/ent/ent/pull/4530)，该修复将 x/tools 升级至 v0.52.0，因此需要先于正式版使用。

`entgo.io/ent` 发布含该修复的正式版本（v0.14.7 或更高）后，应执行：

```sh
go -C server get entgo.io/ent@<正式版本>
```

随后同步修改 Makefile 中 `ent-gen` 的版本号，重跑 `make ent-gen` 与 `make vet test-server`，并移除本节关于伪版本的说明。生成代码在该版本会一并出现模板变化（字段 setter 移入实体包的 `mutation.go`、`*_delete.go`/`*_update.go` 改用 `mutation.Predicates()`），属于预期 churn。

## 测试

```sh
gofmt -w ./cmd ./internal
make test-server   # 同一套用例依次运行 PostgreSQL 与 SQLite

# 直接运行单项测试时默认 PostgreSQL，也可显式选择：
DSH_CONNECT_TEST_DATABASE_DIALECT=sqlite go test ./...
```

`internal/dbtest` 按 `DSH_CONNECT_TEST_DATABASE_DIALECT` 选择数据库。PostgreSQL 通过 `internal/pgtest` 自动拉起一个临时 PostgreSQL 18 容器（整个测试二进制共享一个容器，每个测试拿到独立数据库），结束后清理；SQLite 为每个测试创建独立临时文件，不需要 Docker。

- 复用已有 PostgreSQL 实例：设置 `DSH_CONNECT_TEST_DATABASE_URL`。
- CI 中要求必须跑 PostgreSQL 测试：设置 `DSH_CONNECT_REQUIRE_PG=1`，缺少 Docker 时失败而非跳过；SQLite 测试始终需要执行。
- `make test-e2e` 也会分别运行 PostgreSQL 与 SQLite。SQLite E2E 使用独立临时文件；PostgreSQL 可用 `DSH_CONNECT_E2E_DATABASE_URL` 指定独立业务数据库，不能使用共享开发库或 pgtest 维护库。

集成测试覆盖：配对码一次性消费与过期、显式桌面授权、设备令牌重连、工作区越权拒绝、七类会话命令、create/prompt 并发与持久幂等、持久事件与临时流、慢消费者、离线快速失败、数据库重开后的持久性、**明文令牌不落库**，以及管理 API 的登录、角色隔离、最后 Owner 保护、设备吊销断连与审计记录。手机链路额外覆盖配对码单次消费与过期、令牌轮换、手机登出、管理员吊销、用户删除清理、移动角色隔离，以及访问申请、桌面批准/拒绝/撤销、工作区过滤、移动创建与 prompt 幂等、模型目录与会话级选择、模型选择持久重放、Server 重启恢复、撤销后失败关闭、transcript 和跨手机越权撤销。

## 退出

SIGINT/SIGTERM 会关闭 Connector/App WebSocket、停止接收新请求、执行最长 10 秒的 HTTP 优雅退出，并关闭数据库连接池。