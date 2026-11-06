# DSH Connect Protocol v1

- `openapi.yaml`：Admin/App debug REST 与事件 WebSocket Upgrade 接口。
- `asyncapi.yaml`：Connector 配对/命令/事件和 App 事件帧。
- `schemas/v1/`：JSON Schema 2020-12 版本化 DTO 与 P0 错误码。
- `schemas/v1/mobile.schema.json`：手机配对码、设备身份、移动会话与令牌轮换 DTO。
- `schemas/v1/interaction.schema.json`：远程审批/提问事件、一次性决定与手机投影 DTO。

所有 WebSocket 信封的 `v` 均为 `1`。REST 错误响应为 `{v:1,error:{code,message,retryable,details?}}`。Connector 可按 `requestId` 返回扩展错误码，Server 原样中继。

Server 是透明中继：会话、历史页和 follow 快照由 Connector 从 DSH Host API 获得，不能通过读取 DSH 文件生成。事件持久游标与实时流坐标不能混用；`assistant.stream` 不携带持久 `seq`。

当前 DSH Host `follow` 不接受 `afterSeq/cursor` 参数。外部 cursor 仅表示客户端恢复意图，Connector 必须重新获取 opening snapshot，再按 `(sessionId,seq)` 去重或通过 page 修复空洞。历史分页的 REST `cursor` 映射为排他的 `beforeSeq`，不是 `throughSeq`。

## 远程审批/提问 v1

DSH 的 `approval/request` 与 `user-questions/request` 都是一次性 waterfall。Connector 以 `prepend` 注册并行 answerer 并立即 `next()`，因此桌面审批链不会被替换；手机与桌面谁先回答谁生效。

```text
Connector event  kind=interaction.request  data=InteractionRequestData
Connector event  kind=interaction.resolved data=InteractionResolvedData
Server command   method=interaction.respond params=InteractionRespondParams
App REST         GET  /v1/mobile/interactions
App REST         POST /v1/mobile/interactions/{interactionId}/decision
```

- 转发前 Connector 通过 `interaction.audience`（桌面 Connector 的 request 信封）确认是否有 `approve` 手机在轮询；没有时直接走桌面原生链，不下发手机副本。
- `interaction.request` 仍使用标准 `event` 信封与真实 `sessionId`；Server 只存内存待处理表，不落 DSH 文件，Connector 断连或 Server 重启即清空。
- 手机 grant 与桌面设备授权都必须含 `approve`；Server 在决定时再次校验设备 + 工作区 + scope。
- 决定一次有效：Server 先 CAS 预留 `interactionId`，再转发命令；转发失败会释放预留，让桌面或其他手机仍可回答。
- 审批只接受 `allow-once`/`reject`；提问答案必须匹配题目 id、选项集合与单选/多选约束。
- 手机在场时拥有 grace 窗口（`DSH_CONNECT_INTERACTION_GRACE_MS`，默认 6 秒）；窗口结束先下发 `interaction.resolved(desktop)` 撤回手机副本，再由 Connector 调用原桌面审批链。
- 超时、撤回或协议错误失败关闭，不伪造批准。

## Create / Prompt / Model Selection 幂等边界

`session.create`、`session.prompt` 与 `session.model.select` 都使用持久 `requestId` 幂等。不同命令必须使用不同的 requestId；相同 ID 搭配不同 method、device 或 params 会返回 `idempotency_conflict`。相同并发或完成后的重放返回首次结果，不会再次到达 Connector。模型选择的 `sessionId/workspaceId/provider/model/reasoningEffort` 都进入 command params 与请求哈希。

在 Server 确认设备不在线、尚未向 Connector 提交时，创建、提示词和模型选择请求均返回 `device_offline`，并携带 `error.details.submitted=false`。该结果不写入持久幂等 Store，设备恢复后客户端必须沿用原 `requestId` 重试。命令已经写出后发生断线或 timeout 时结果不确定，Server 仍持久化首次结果，重试不会再次提交。移动端“创建并发送首条指令”依次调用 create 与 prompt，并分别保留两个请求 ID；create 成功后的 prompt 重试不得重新创建会话。模型选择使用另一枚独立 requestId。

`GET /v1/mobile/sessions/{id}/model` 复用 `read` scope，组合 Host `modelCatalog` 与 Session `modelSelection` 投影，不激活冷 Agent。POST 同路径复用 `prompt` scope，Connector 校验模型后直接调用公开 `agent.model.select`，不调用会保存部署默认值的 `sessionController.selectModel`，也不读写 DSH profile。模型不可用返回 `model_unavailable`，会话需先迁移返回 `session_migration_required`。

## App follow 生命周期

`session.follow` 与新增的 `session.unfollow` 都是 v1 `command`，要求 `read` scope。Server 为每次 `/v1/events/ws` follow 生成唯一 `followId`；follow params 为 `sessionId/followId/stream/cursor?`，成功 follow 退出时使用独立的后台超时发送 unfollow，params 为 `sessionId/followId`，不复用已取消的 HTTP 请求上下文。

每个 device+session 仅允许一个活跃 App follow。新事件 WS 替换旧 subscriber，旧 WS 收到 `follow_superseded`；旧 WS 的 unfollow 始终携带自己的 `followId`，Connector 必须仅在 ID 与当前活跃 follow 相符时清理，避免误杀新 follow。

REST 请求 DTO 与 command params 均禁止未定义字段，Server 对未知 JSON 字段返回 `invalid_request`，不会静默丢弃。

## 附件 v1

会话声明的文件走两条独立通道，元数据与字节严格分离：

- `session.attachment.fetch`（v1 `command`，要求 `read` scope）：params 为 `sessionId/workspaceId/attachmentId`，30s 默认超时上限内由 Server 用 60s 触发。Connector 在**命令返回前**把字节上传到 `POST /v1/connector/attachments/{attachmentId}`（`application/octet-stream`，device token 认证，`X-DSH-Attachment-{Session,Bytes,Sha256}`），随后返回 `{status:"ready",bytes,sha256,mime}`。
- `GET /v1/mobile/attachments/{attachmentId}`：手机只用不可猜测的 `attachmentId`，从不提交路径。`200` 字节（`ETag` 支持 `If-None-Match` → `304`）、`202` 拉取中（`Retry-After`）、`409` 桌面侧判定（`changed`/`denied`/`too_large` 等）、`404` 未知或已过期、`413` 超限、`403` grant 失效。

`MobileMessage.attachments[]` 为可选字段，旧客户端忽略即可；`state` 由 Server 覆盖（Connector 只报初始判定），因此同一附件在不同手机上状态一致。字节就绪后 Server 向该 `(deviceId, sessionId)` 广播 `attachment.ready`（仅 `attachmentId/bytes/sha256`）。

`MobileMessage.delivery` 标记 Server/Connector 合成的"本轮交付"N 个文件"消息：当某个 turn 有交付但没有任何 assistant 文本时使用，避免图片无处挂载。附件 id 形如 `att_` + base64url(sha256(sessionId\0source\0seq\0index))[:24]，确定性且不含路径。

## 手机配对 v1

手机配对与桌面配对完全独立，流程为：

```text
POST /v1/admin/mobile/pairing-codes
→ 返回一次性 code、expiresAt、serverUrl、pairingUrl
→ App 扫描 dshconnect://pair?... 二维码
→ POST /v1/mobile/pair {code,deviceName,platform,appVersion}
→ 返回 mobileDeviceId、user、accessToken、refreshToken
→ POST /v1/mobile/auth/refresh 轮换两枚令牌
→ GET /v1/mobile/me / POST /v1/mobile/auth/logout
```

- 配对码短时有效、只能消费一次；数据库只保存 SHA-256 hash。
- 配对目标用户由服务端存储的配对码决定，不信任手机请求中的 `userId`。
- Access Token 与 Refresh Token 均只保存 hash；刷新时两者同时轮换，旧凭证立即失效。
- 手机身份独立于桌面 Connector；管理员可列出并吊销手机，但不会删除 DSH 会话。
- `pairingUrl` 当前形如 `dshconnect://pair?code=...&server=...&v=1`，二维码内容必须按 URI 解析，不应依赖参数顺序。

## 手机访问授权 v1

手机配对只证明设备身份，不产生任何桌面权限。访问授权链路为：

```text
GET  /v1/mobile/access             → 桌面列表、可用工作区/动作、当前 grant
POST /v1/mobile/access/requests    → {deviceId, workspaces, scopes}，创建 pending grant
（桌面 Connector 通过已认证 WSS 发送 request：mobile.access.list / mobile.access.decide / pair.updateGrants / interaction.audience）
→ 桌面用户 allow / deny / revoke
GET  /v1/mobile/workspaces         → 仅 active grant 中的工作区
GET  /v1/mobile/sessions           → 仅 active grant 工作区内的会话
POST /v1/mobile/sessions           → 需要 prompt scope，持久 requestId 幂等创建
GET  /v1/mobile/sessions/{id}/messages → 稳定 transcript
GET  /v1/mobile/sessions/{id}/model    → 需要 read scope，目录 + 当前会话模型
POST /v1/mobile/sessions/{id}/model    → 需要 prompt scope，只改会话模型
POST /v1/mobile/sessions/{id}/prompt   → 需要 prompt scope
POST /v1/mobile/sessions/{id}/cancel   → 需要 cancel scope
DELETE /v1/mobile/access/{grantId}     → 手机自行撤销
```

约束：

- 申请的工作区与动作必须是桌面 Connector 已授权集合的子集；Server 拒绝越权申请。
- grant 默认 `pending`，只有桌面 Connector 的 `allow` 能将其置为 `active`；`deny`/`revoke` 分别终止或回收访问。
- 手机吊销、logout、桌面吊销会同步撤销相关 grant。
- 每次创建/历史/模型读取/模型选择/prompt/cancel 都由 Server 校验 grant，再由 Connector 校验工作区授权或会话真实归属，双重 fail-closed。
- 单个手机可访问多个桌面；会话列表按桌面聚合，离线桌面只产生 warning，不阻塞其他桌面。

**边界：** `/v1/devices`、`/v1/sessions`、`/v1/events/ws` 等调试 API 仍只接受 bootstrap token。移动 Access Token 只能访问上述 `/v1/mobile/*` 接口，且受 grant 约束；移动端通过 `/v1/mobile/events/ws` 订阅 `assistant.stream` 增量（Connector 已归一化为 `start/delta/end`），HTTP transcript 仍作为断线恢复和最终消息的兜底。原生 App 使用 `Authorization` 头；浏览器不能在 WebSocket 握手中设置自定义头，因此该路径额外接受短时 `accessToken` 查询参数，生产必须使用 WSS 并避免记录完整 URL。
