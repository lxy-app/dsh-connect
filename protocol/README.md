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

## Prompt 幂等边界

`session.prompt` 在 Server 确认设备不在线、尚未向 Connector 提交时返回 `device_offline`，并携带 `error.details.submitted=false`。该结果不写入持久幂等 Store，设备恢复后客户端必须沿用原 `requestId` 重试。命令已经写出后发生断线或 timeout 时结果不确定，Server 仍持久化首次结果，重试不会再次提交。

## App follow 生命周期

`session.follow` 与新增的 `session.unfollow` 都是 v1 `command`，要求 `read` scope。Server 为每次 `/v1/events/ws` follow 生成唯一 `followId`；follow params 为 `sessionId/followId/stream/cursor?`，成功 follow 退出时使用独立的后台超时发送 unfollow，params 为 `sessionId/followId`，不复用已取消的 HTTP 请求上下文。

每个 device+session 仅允许一个活跃 App follow。新事件 WS 替换旧 subscriber，旧 WS 收到 `follow_superseded`；旧 WS 的 unfollow 始终携带自己的 `followId`，Connector 必须仅在 ID 与当前活跃 follow 相符时清理，避免误杀新 follow。

REST 请求 DTO 与 command params 均禁止未定义字段，Server 对未知 JSON 字段返回 `invalid_request`，不会静默丢弃。

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
GET  /v1/mobile/sessions/{id}/messages → 稳定 transcript
POST /v1/mobile/sessions/{id}/prompt   → 需要 prompt scope
POST /v1/mobile/sessions/{id}/cancel   → 需要 cancel scope
DELETE /v1/mobile/access/{grantId}     → 手机自行撤销
```

约束：

- 申请的工作区与动作必须是桌面 Connector 已授权集合的子集；Server 拒绝越权申请。
- grant 默认 `pending`，只有桌面 Connector 的 `allow` 能将其置为 `active`；`deny`/`revoke` 分别终止或回收访问。
- 手机吊销、logout、桌面吊销会同步撤销相关 grant。
- 每次会话/历史/prompt/cancel 都由 Server 校验 grant，再由 Connector 校验会话真实所属工作区，双重 fail-closed。
- 单个手机可访问多个桌面；会话列表按桌面聚合，离线桌面只产生 warning，不阻塞其他桌面。

**边界：** `/v1/devices`、`/v1/sessions`、`/v1/events/ws` 等调试 API 仍只接受 bootstrap token。移动 Access Token 只能访问上述 `/v1/mobile/*` 接口，且受 grant 约束；移动端通过 `/v1/mobile/events/ws` 订阅 `assistant.stream` 增量（Connector 已归一化为 `start/delta/end`），HTTP transcript 仍作为断线恢复和最终消息的兜底。原生 App 使用 `Authorization` 头；浏览器不能在 WebSocket 握手中设置自定义头，因此该路径额外接受短时 `accessToken` 查询参数，生产必须使用 WSS 并避免记录完整 URL。
