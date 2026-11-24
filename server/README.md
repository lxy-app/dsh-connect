# DSH Connect Server

单实例 Go 中继 Server。它只通过 Connector 调用 `session.*` 方法并中继事件，**不读取 DSH 文件、不直接调用 DSH Service，也不保存会话正文**。

持久层为 **PostgreSQL 18（默认）或 SQLite + ent ORM**：配对码、设备凭据 hash、create/prompt/model.select 幂等结果、审计、管理账号与浏览器会话、手机登录设备与移动令牌、用户访问策略。所有密钥只以 SHA-256 存储。两种数据库共用同一套 ent schema 和 Store 业务代码，由 `DSH_CONNECT_DATABASE_URL` 的 scheme 选择。

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
| `DSH_CONNECT_MOBILE_ACCESS_TTL` | `15m` | 手机 Access Token 有效期，Go duration |
| `DSH_CONNECT_MOBILE_REFRESH_TTL` | `720h` | 手机 Refresh Token 有效期，Go duration |
| `DSH_CONNECT_MOBILE_REFRESH_REUSE_GRACE` | `24h` | 轮换后旧 Refresh Token 仍可重试的宽限窗口；`0` 表示立即失效 |
| `DSH_CONNECT_LISTEN_ADDR` | `127.0.0.1:8787` | HTTP 监听地址 |
| `DSH_CONNECT_SERVER_URL` | 按监听地址推导 | 配对码响应中的外部 URL |
| `DSH_CONNECT_TLS_CERT_FILE` / `_KEY_FILE` | 空 | 同时设置后对外为 https/wss |
| `DSH_CONNECT_PREVIEW_WORKER_URL` | 空 | 独立 Office 预览 Worker 的内部 HTTP(S) URL；空时仍支持 PDF 直出，Office 返回 `preview_unavailable` |
| `DSH_CONNECT_PREVIEW_WORKER_TOKEN` | 空 | 主 Server 与预览 Worker 共享的 Bearer Token；配置 Worker URL 后必填 |
| `DSH_CONNECT_PREVIEW_TIMEOUT` | `90s` | 单次预览转换超时，Go duration |
| `DSH_CONNECT_MAX_PREVIEW_BYTES` | `52428800`（50 MiB） | 预览源文档与派生 PDF 的单文件字节上限 |

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
| GET | `/v1/admin/mobile-devices` | owner/admin/auditor | 手机设备列表，永不返回令牌 |
| POST | `/v1/admin/mobile-devices/{id}/revoke` | owner/admin | 吊销手机及其访问/刷新令牌 |
| GET/POST | `/v1/admin/policies` | 读含 auditor；写 owner/admin | 访问策略列表/创建 |
| PATCH/DELETE | `/v1/admin/policies/{id}` | owner/admin | 按 revision 更新/删除策略，冲突返回 `conflict` |
| GET | `/v1/admin/users/{id}/access-preview` | owner/admin/auditor | 按用户预览策略可见桌面、工作区和 scopes，不含路径 |
| GET | `/v1/admin/interactions` | owner/admin/auditor | 只读待处理审批/提问及完整核对上下文，不提供 Admin 决定 |
| GET/PATCH | `/v1/admin/approval-policy` | 读含 auditor；写 owner/admin | 远程审批开关、30–600 秒 TTL 与 revision 乐观锁 |
| GET | `/v1/admin/settings` | owner/admin | 只读运行配置、数据库方言/健康与生成时间，不含秘密 |

安全约束：

- 最后一位 **active** Owner 不能被降级、禁用或删除（返回 `conflict`）。Store 在事务内锁定 active Owner 集合并完成检查与写入，避免并发请求同时移除不同 Owner；删除用户及其依赖清理也在同一事务内完成。
- Admin 只能维护非 Owner 账号；Owner 的显示名、角色、状态和密码只能由 Owner 修改，防止通过重置 Owner 密码提权。
- Member 不能通过概览或设备列表读取全局账号、审计、工作区路径或设备指纹。
- 手机有效权限为“用户所有启用策略按工作区求并集 ∩ 桌面当前工作区/scopes”。无策略默认拒绝，mobileDeviceId 不影响权限；策略或桌面授权收窄会关闭相关移动事件流并要求重新鉴权。
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

## 手机用户登录与访问 API

手机通过用户邮箱和密码登录，设备身份只管理移动凭据，不共享桌面 Connector 凭据。Web 管理后台的 **手机设备** 页面（`/mobile`）负责查看登录设备和吊销凭据：

| 方法/通道 | 路径 | 行为 |
|---|---|---|
| POST | `/v1/mobile/auth/login` | 无 Bearer；校验用户邮箱/密码并创建设备移动令牌，连续失败限流 |
| POST | `/v1/mobile/auth/refresh` | 原子轮换 Access/Refresh Token，旧 refresh 立即失效 |
| POST | `/v1/mobile/auth/logout` | 使用手机 Access Token 吊销当前登录设备 |
| GET | `/v1/mobile/me` | 返回当前登录设备与所属用户 |
| GET | `/v1/mobile/access` | 返回用户策略与 Connector 当前授权交集后的桌面、工作区和动作 |
| GET | `/v1/mobile/workspaces` | 用户有效工作区目录 |
| GET | `/v1/mobile/sessions` | 聚合授权桌面会话；离线桌面返回 warning |
| POST | `/v1/mobile/sessions` | 创建会话，需 `prompt`，沿用独立 requestId 幂等 |
| GET | `/v1/mobile/sessions/{id}/messages` | 稳定 transcript，需 `read`；WSS 断开时的兜底 |
| GET | `/v1/mobile/workspaces/{id}/model` | 新建会话草稿的可用模型目录，需 `read`；不创建会话、不读投影或激活 Agent |
| GET | `/v1/mobile/sessions/{id}/model` | 当前会话模型与可用目录，需 `read`；不激活冷 Agent |
| POST | `/v1/mobile/sessions/{id}/model` | 只切换当前会话模型，需 `prompt`，持久幂等 |
| GET | `/v1/mobile/events/ws` | 需用户有效 `read`；compact follow 并过滤原始工具 payload |
| POST | `/v1/mobile/sessions/{id}/prompt` | 发送提示词，需 `prompt`，沿用 requestId 幂等 |
| POST | `/v1/mobile/sessions/{id}/cancel` | 取消当前 Turn，需 `cancel` |
| GET | `/v1/mobile/interactions` | 用户可回答的待处理审批/提问，需 `approve` |
| POST | `/v1/mobile/interactions/{id}/decision` | 一次性提交审批或提问答案，转发给 Connector |
| GET | `/v1/admin/mobile-devices` | 登录设备管理列表 |
| POST | `/v1/admin/mobile-devices/{id}/revoke` | 管理员吊销单台登录设备 |

安全约束：

- 密码只用于当次登录，不持久化；Access/Refresh Token 明文只返回一次，数据库只保存 SHA-256 hash。
- 未知邮箱和错误密码统一返回 `unauthorized`；限流键只包含来源 IP 与规范化邮箱，不包含密码。
- 手机被禁用、吊销或 refresh 已过期时，`/v1/mobile/me` 与 refresh 都失败关闭。
- 登录不代表获得桌面权限。有效权限仅为用户所有 enabled 策略的并集与桌面当前 Workspaces/Scopes 的交集，同一用户所有手机结果相同。
- 不再存在手机配对码、逐手机访问申请或 `mobile.access.list` / `mobile.access.decide` RPC。
- `pair.updateGrants` 仍允许桌面 Connector 显式更新自己的 workspace/scope；Server 校验动作词汇并写审计，移动权限随交集立即收窄。
- 会话列表、create、transcript、模型、prompt、cancel、interactions 和附件每次都校验用户有效权限；Connector 再校验桌面授权、会话真实归属或审批答案，形成双重 fail-closed。
- 待处理审批只存在内存中，Server 重启或 Connector 断连即清空；同一 interaction 在 Server 内用 CAS 预留，避免重复消费。
- 手机 logout、管理员吊销手机、用户被禁用或删除时，Server 关闭对应移动事件流。策略和桌面授权收窄同样立即断流并重新鉴权。
- **移动 Access Token 不能访问调试接口。** 移动端仅使用受用户策略约束的 `/v1/mobile/*` API。

## 移动端附件

会话中"交付/返回"的文件由 Connector 声明（不含路径、不含字节），随 transcript 下发；手机点开时再由 Connector 按桌面侧校验读盘并上传，手机通过独立 HTTPS 端点取图。**路径永不出桌面，字节不进 WSS/JSON。**

| 端点 | 调用方 | 说明 |
|---|---|---|
| `GET /v1/mobile/attachments/{attachmentId}` | App | `200` 字节（带 `ETag`，支持 `If-None-Match` → `304`）；`202` 正在拉取（`Retry-After`）；`409` 桌面侧失败（带 `errorCode`）；`403` 用户权限失效；`404` 未知/过期；`413` 超限 |
| `GET /v1/mobile/attachments/{attachmentId}/preview` | App | PDF 直接 inline 返回；Office 经独立 Worker 转 PDF。`202` 区分 `fetching/converting`，`503 preview_unavailable`、`415 preview_unsupported`、`409 preview_failed`；预览缓存不改变原附件状态 |
| `POST /v1/connector/attachments/{attachmentId}` | Connector | `application/octet-stream`，device token 认证；`X-DSH-Attachment-{Session,Bytes,Sha256}` 必须与行内归属和 body 一致 |

实现要点：

- **学习式索引**：Server 在处理 `GET /v1/mobile/sessions/{id}/messages` 时把 Connector 返回的 `attachments` upsert 进 `session_attachments`；未被学习过的 id 一律 `404`，从源头阻断枚举。
- **反向授权**：下载端点只按行内记录的 device/workspace/session 校验用户有效权限，不信任手机提交的任何归属参数。
- **状态由 Server 拥有**：Connector 只报 `known`，`fetching/ready/failed/unavailable` 与 `sha256` 由 Server 推进；`ready` 不会因新的 transcript 回落，传输/上传产生的 `failed` 也不会被普通轮询重置成 `known`，只有移动 GET 会显式触发重试。Server 启动时会把上一进程遗留的 `fetching` 恢复为 `known`，避免永久等待已消失的命令。
- **字节与元数据分离**：内容寻址写 `DSH_CONNECT_ATTACHMENT_DIR/<sha[0:2]>/<sha>`，DB 只存引用；上传先写临时文件再 rename，避免半成品。Docker 镜像默认使用可写的 `/data/attachments`，Compose 必须挂载 `dsh-connect-attachments` 持久卷。
- **上传后的长度一致性**：已有摘要的附件，大小以该摘要对应的 blob 索引为准，后续 transcript 声明不能覆盖。会话刷新会修复旧版本覆盖过的长度（包括零字节文件）；更新带摘要条件，避免与并发上传完成互相覆盖。升级后关闭旧预览、刷新会话，再重新打开附件；无需删除文件或清空缓存。
- **就绪通知**：上传成功后向该 `(deviceId, sessionId)` 广播 `attachment.ready`（仅元数据），App 立即重载而不轮询。
- **失败关闭**：Connector 侧路径必须落在会话工作区内（默认拒绝工作区外交付）、拒绝 final symlink、命中敏感名单直接拒绝、并在读盘前重新 `stat` 比对基线，变化返回 `attachment_changed` 且不发送内容。
- **预览隔离**：主 Server 不执行 LibreOffice。`DSH_CONNECT_PREVIEW_WORKER_URL` 与独立 `DSH_CONNECT_PREVIEW_WORKER_TOKEN` 同时配置后，才把已授权 blob 发给 `cmd/preview-worker`；Worker 使用固定扩展名白名单、临时目录、无 Shell 的命令执行、输入/输出上限和超时。预览 PDF 按原文件摘要与转换版本派生缓存键，原子写入 `AttachmentDir/previews`。

独立 Worker 使用同一组 `DSH_CONNECT_PREVIEW_WORKER_TOKEN`、`DSH_CONNECT_PREVIEW_TIMEOUT`、`DSH_CONNECT_MAX_PREVIEW_BYTES` 配置，并通过 `DSH_CONNECT_PREVIEW_LISTEN_ADDR` 设置监听地址（默认 `127.0.0.1:8788`，容器可改为 `0.0.0.0:8788`）。`DSH_CONNECT_PREVIEW_CONCURRENCY` 默认 `2`，限制 LibreOffice 进程数且排队同样受转换超时约束；`DSH_CONNECT_PREVIEW_SOFFICE` 可显式指定可执行文件，空时依次查找 `soffice`、`libreoffice`。转换子进程仅获得最小环境白名单，不继承 Worker Token。`GET /healthz` 返回无敏感信息的 `200 ok`；转换入口仅接受带共享 Bearer Token 的 `POST /convert` 原始字节。

移动端支持图片、MD/TXT/PDF 应用内预览，Office 文档依赖上述可选 Worker；手机上行需启用 `DSH_CONNECT_ATTACHMENTS=readwrite`，并由用户策略和桌面当前授权共同为该工作区提供 `prompt` 权限。基础配置项见 `.env.example` 的 `DSH_CONNECT_ATTACHMENT*` 与 `DSH_CONNECT_PREVIEW*`（默认单文件 20 MiB，blob 目录总量 2 GiB，blob TTL 168h，预览 PDF 50 MiB，转换 90 秒）。

已知未实现：blob 与预览派生 PDF 的 TTL/容量定时回收任务（当前仅记录 TTL 配置，不主动删除过期文件）。手机上行需启用 `DSH_CONNECT_ATTACHMENTS=readwrite`，并由用户策略和桌面当前授权共同为该工作区提供 `prompt` 权限。

## 数据模型（ent schema）

| 表 | 用途 |
|---|---|
| `pairing_codes` | 一次性配对码 hash 与消费状态 |
| `devices` | 设备身份、授权工作区/scope、令牌 hash、在线状态 |
| `idempotency_records` | `session.create` / `session.prompt` / `session.model.select` 持久幂等结果 |
| `audit_entries` | 只追加审计，按 `occurred_at`/`device_id`/`action` 建索引；可选 details 保存策略 before/after |
| `access_policies` | 用户关联、启用状态、桌面×工作区×scope 规则与 revision |
| `approval_policies` | 单例远程审批开关、TTL 与 revision |
| `users` | 管理账号（owner/admin/member/auditor） |
| `admin_sessions` | 浏览器登录会话 token hash |
| `mobile_pairing_codes` | 历史遗留手机配对码数据；新登录流程不读写，仅保留表避免破坏性迁移 |
| `mobile_devices` | 手机登录设备身份、平台、Access/Refresh Token hash、过期与吊销状态 |
| `mobile_access_grants` | 历史遗留逐手机授权数据；不再参与有效权限计算，仅保留表避免破坏性迁移 |
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

集成测试覆盖：桌面配对码一次性消费与过期、显式桌面授权、设备令牌重连、工作区越权拒绝、七类会话命令、create/prompt 并发与持久幂等、持久事件与临时流、慢消费者、离线快速失败、数据库重开后的持久性、**明文令牌不落库**，以及管理 API 的登录、角色隔离、最后 Owner 保护、设备吊销断连与审计记录。手机链路额外覆盖邮箱密码登录、失败限流、令牌轮换、手机登出、管理员吊销、用户删除清理、同账号多手机继承用户策略、无策略默认拒绝、策略与 Connector 收窄后的全设备收紧、工作区过滤、移动创建与 prompt 幂等、模型目录与会话级选择、模型选择持久重放、Server 重启恢复、撤销后失败关闭、transcript、审批一次性决定和跨手机附件隔离。

## 退出

SIGINT/SIGTERM 会关闭 Connector/App WebSocket、停止接收新请求、执行最长 10 秒的 HTTP 优雅退出，并关闭数据库连接池。
