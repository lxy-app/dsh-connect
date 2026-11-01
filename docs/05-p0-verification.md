# P0 实现与验证记录

- 日期：2026-10-28
- 实现基线：Protocol v1、Go Server、DSH Connector `0.1.0`
- DSH 适配基线：`0.2.1-rc.3`

## 1. 当前结论

P0 代码纵向闭环已实现：

```text
调试客户端 → Go Server → 出站 Connector WSS → Host 适配层
           ← REST / WSS ← 命令结果与事件 ← sessionController
```

桌面面板通过正式 `/dsh-connect` unary RPC 完成配对与授权；会话命令和事件不经过该 RPC。

**当前通过的是单元测试、Go/Node 跨语言集成测试和可控 Host 仿真。真实 DSH 插件生命周期与真实 Agent 执行验收必须单独记录，不能由仿真结果替代。**

## 2. 自动化验证

| 命令 | 范围 |
|---|---|
| `make test-server` | Go Store、配对、权限、路由、幂等、事件与 Hub 测试 |
| `make test-connector` | Connector 配对、传输、输入、Host DTO、权限、游标、审批 answerer 与插件入口 |
| `make test-e2e` | 启动实际 Go Server，运行真实 Connector 协议代码与可控 Host 仿真 |
| `make vet` | Go 静态检查 |

E2E 覆盖：

1. `pair.start → pair.challenge → pair.authorize → pair.complete`。
2. `session.list/create/page/prompt/follow/unfollow/cancel`。
3. opening snapshot、持久 `seq` 事件和临时 assistant stream。
4. 同一 prompt requestId 只到达 Host 一次。
5. 使用持久设备令牌建立新出站连接。
6. Connector 断开后 `device_offline` 快速失败。

## 3. 已修复的跨端契约问题

- `pair.authorize` 补齐必填 requestId。
- `session.create` 在 Server 和 Connector 两侧统一要求 `prompt` scope。
- 临时流不再被 Server 重新编码为持久 `seq:0`。
- Session List/Page/Prompt DTO 与 OpenAPI/JSON Schema 对齐。
- 历史 cursor 按 Host 语义映射为排他 `beforeSeq`。
- Workspace 归属来自 `workspaceRegistry.sessionIds`，不信任客户端自报值。
- follow 使用闭包补 sessionId；snapshot 校验 `header.id`。
- 自动重连失败不再阻塞重新配对；授权完成前预初始化命令适配，消除首命令竞态。
- Workspace registry 每次整体替换并逐帧复查 active follow，detach/move 会撤销旧授权。
- requestId 同时绑定 method 与规范化 params，避免 create/cancel 错返旧结果。
- Transport generation 防止 stop/start 竞态复活旧连接；pending challenge 断连即失效。
- App 事件 WS 关闭通过 followId 显式 unfollow，替代订阅不会被旧清理误杀。
- 明确未提交的 offline prompt 不落永久幂等记录，恢复后可沿用原 requestId 重试。

## 4. 真实 DSH 验收清单

以下项目必须实际执行后才能宣称 P0 通过门槛：

- [x] 本地 tarball 已通过 Desktop CLI 安装，并写入 desktop Profile bundles（2026-10-28）。
- [ ] Running Host 显示 Connector active，DSH 正常启动。
- [ ] Connector 加载失败不会破坏 DSH 启动。
- [ ] 桌面面板可生成挑战、核对指纹并显式授权。
- [ ] 未授权前 Server 无法列出会话。
- [ ] 仅授权工作区的会话可被远程访问。
- [ ] `create → follow snapshot → queue prompt → durable turn/end` 成功。
- [ ] 同 requestId 重试不产生重复提示词。
- [ ] `steer` 与 `cancel` 行为同桌面 DSH 一致。
- [ ] Server 断线自动重连，DSH 重启后重新列出并恢复会话。
- [ ] 启用、停用、热更新、升级、回退和卸载行为明确且无残留加载项。

## 5. 手动 smoke path

1. 设置强随机 `DSH_CONNECT_BOOTSTRAP_TOKEN` 并运行 `make run-server`。
2. 用调试客户端 `pair-code` 生成一次性桌面配对码。
3. 在真实 DSH Connector 面板输入 Server、配对码和桌面名称。
4. 核对指纹，选择最小工作区和 scopes，确认授权。
5. 用 `devices/list/create` 验证真实设备与会话。
6. 先 `follow`，再用稳定 requestId `prompt`。
7. 观察真实持久事件和对应 turn/end；重复同一 requestId。
8. 验证 cancel、Server 重启、Connector 重连和 DSH 重启。

命令详见 [Connector 文档](../connector/dsh-plugin/README.md) 与 [Server 文档](../server/README.md)。
