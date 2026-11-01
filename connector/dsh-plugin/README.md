# DSH Connect Connector（P0）

这是实际的 DeepSeek Harness 桌面 Connector，不是根目录的交互原型，也不是 `prototype/` 中的旧实验插件。

当前版本锁定 **DSH `0.2.1-rc.5`**。Host API 属于版本敏感接口，升级 DSH 后必须重新核对方法签名和事件 DTO。

## 已实现

- 持久化 npm bundle，Host 命名导出 `apply/inject`。
- DSH 侧边栏桌面面板：Server 配置保存、一次性配对码、桌面名称、指纹核对、工作区多选和动作授权，以及**手机访问授权**（批准/拒绝/撤销手机申请的工作区与动作）。
- `/dsh-connect` 自定义 unary RPC，仅 owner peer 可调用；会话流不经过该 RPC。
- 单条主动出站 Connector WSS，心跳、指数退避、设备令牌重连和固定背压上限。
- `session.list/create/page/transcript/prompt/follow/unfollow/cancel` Host 适配；`session.transcript` 默认只保留 user/assistant 对话文本，工具调用/结果以及注入的 runtime/time/skill context 不进入移动 transcript；历史分页先解析当前 Session 的 projection watermark 再传 `throughSeq`（DSH 对 `throughSeq=-1` 实际返回空页），超出体积预算时优先保留最新消息。
- 使用 `workspaceRegistry.sessionIds` 校验真实 session → workspace 归属，默认拒绝；归属变化会撤销旧权限和 active follow。
- prompt 全链路 `requestId` 去重，超时后不盲目重新提交。
- follow opening snapshot、持久事件去重/空洞检测、assistant stream 独立坐标；移动端 follow 使用 `compact` 省略大快照，assistant stream 归一化为 `start/delta/end` 文本增量；最后一个 App 事件连接关闭后显式 unfollow。
- 插件卸载/断连时取消 Host 调用和旧 follow；恢复以 DSH snapshot 为准。
- 通过同一条已认证出站 WSS 发送 `request` 信封（`mobile.access.list` / `mobile.access.decide`），桌面面板据此读取和决定手机授权；手机访问范围不写进本地凭据。

## 安全边界

- 未确认桌面授权前不接受会话命令。
- 工作区不默认全选；面板默认只选择 `read`，`prompt/cancel` 需显式开启。
- 创建会话也要求 `prompt` scope。
- 不支持任意 `cwd`、任意 Shell、附件或远程关闭审批。
- 远程审批/提问使用 `prepend` 注册 `approval/request` 与 `user-questions/request` answerer，并先向 Server 查询 `interaction.audience`：只有“有 `approve` 的手机正在轮询”时，手机才接管这次请求。
- 手机接管时先不启动桌面审批链，手机独占一个 grace 窗口（`DSH_CONNECT_INTERACTION_GRACE_MS`，默认 6 秒）；窗口内作答则桌面完全不会弹卡。窗口结束则**先撤回手机副本**，再调用 `next()` 交给桌面原生审批链，因此两端不会同时出现两张卡，也不会留下已失效的卡片。
- 没有手机在轮询时直接走桌面原生链，手机不会收到无法处理的副本。
- 升级到 `0.1.11` 后，旧的桌面设备记录仍只有 `read/prompt/cancel`：在桌面面板点击“启用远程审批”即可通过 `pair.updateGrants` 追加 `approve`（无需重新配对），随后在手机上重新申请包含“远程审批”的访问授权并由桌面确认。未启用时 Connector 不转发任何审批，桌面链保持原样。
- 只有同时具备 `approve` scope 且会话所属工作区已授权时才转发；Server 侧还要求手机 grant 含 `approve`，形成双重校验。撤回、离线、无答案都不会伪造批准。
- 手机是否“在场”由 Server 的轮询时间戳判断（10 秒窗口）；App 在前台每 2 秒轮询一次并在回到前台时立即刷新。
- Server/Connector 不直接读写 DSH Session Log 文件。
- 设备令牌不会通过状态 RPC 返回。P0 本地状态文件权限为 `0600`；生产版本仍应接入系统 Keychain/Keystore 或 DSH secret store。

默认 Connector 状态文件：

```text
~/.dsh-connect/connector.json
```

开发/测试可用 `DSH_CONNECT_STATE_FILE` 覆盖。状态文件包含设备凭据，不应提交到仓库或发送到其他 Server。写入在同一 Host 进程内按文件名串行并原子替换；不要让多个 DSH 进程共享同一状态文件。损坏状态会按未配对失败关闭，用户需重新配对。

正式面板通过 `settings.update` 保存 Server 地址和桌面名称。未保存界面配置时，`DSH_CONNECT_URL`（兼容别名 `DSH_CONNECT_SERVER_URL`）仅作为初始连接地址；用户在界面保存后，持久配置优先于环境变量。更换已配对 Server 必须明确确认并重新配对，旧设备令牌不会发送到新 Server。

若配对在 `pair.complete` 传输或本地凭据落盘前中断，Server 不会恢复明文设备令牌。面板会使旧 challenge 失效；请生成新配对码重配，不要复用旧指纹或旧 challenge。

## 插件包

```sh
cd connector/dsh-plugin
npm install
npm run typecheck
npm run build
npm pack --dry-run
```

插件源码统一使用 TypeScript，位于 `src/`；`src/host-api.ts` 集中声明当前 DSH Host 契约，`src/types.ts` 声明 Connector 协议 DTO。`tsc` 将 Host 与 Web Client 构建到 `dist/`，Cordis 运行时只加载构建后的 JavaScript，不直接加载 `.ts`。DSH Web Client 通过经典脚本加载 `dist/client.js`，因此构建末尾会运行 `scripts/strip-client-export.mjs` 移除 TypeScript 自动添加的 `export {}`；删除该步骤会导致 `Unexpected token 'export'` 并阻止 Web 启动。调试客户端位于 `src/bin/`，测试位于 `test/`，均不进入运行时发布物。

运行时包包含 `dist/` 和 `cordis.patch.yml`，`package.json` 中声明了 `dsh.bundle.patch` 与 Web client。它是持久化 bundle，不能放入只支持受限动态 VM 的 Host runner。

安装时使用 DSH Plugin Manager 的本地 npm bundle 流程，并确认 DSH 版本与 `engines.dsh` 一致。真实安装、启停、升级和卸载必须按 `docs/04-implementation-roadmap.md` 验证；语法检查和打包成功不等于生命周期验收通过。

macOS Desktop 也可使用自带 CLI（路径按本机安装位置调整）：

```sh
APP='/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
CLI='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'

ELECTRON_RUN_AS_NODE=1 "$APP" "$CLI" plugin --profile desktop add \
  '/absolute/path/to/lxyapp-dsh-connect-0.1.0.tgz'
ELECTRON_RUN_AS_NODE=1 "$APP" "$CLI" plugin --profile desktop why \
  '@lxyapp/dsh-connect'
```

CLI/pnpm 成功只表示包已安装并加入 Profile，不能证明 running Host 已 apply。必须在 Plugins 页确认 active；最快回退是先将 bundle Off，完整卸载命令为：

```sh
ELECTRON_RUN_AS_NODE=1 "$APP" "$CLI" plugin --profile desktop remove \
  '@lxyapp/dsh-connect'
```

pnpm/依赖日志位于 `~/.dsh/profiles/desktop/.plugin-manager/logs/operation-*/pnpm.log`。

## 桌面 RPC

Host `ctx.provide('dshConnectConnector')` 供 Host 内集成使用，Web 面板通过 `/dsh-connect` 调用：

| Endpoint | 用途 |
|---|---|
| `status.get` | 非敏感连接状态、配置来源，不返回设备令牌 |
| `workspace.list` | 当前 DSH 工作区基线 |
| `settings.update` | 校验并保存 Server 地址和桌面名称；已配对 Server 变更需确认 |
| `pair.start` | 校验配对码并等待桌面确认 |
| `pair.authorize` | 显式提交工作区和 scopes |
| `pair.cancel` | 取消待确认配对 |
| `connection.connect` | 使用已配对凭据重连 |
| `connection.disconnect` | 主动断开，不删除 DSH 会话 |
| `mobile.access.list` | 经 Server 读取本桌面的手机访问申请与 active grant |
| `mobile.access.decide` | 桌面用户 allow/deny/revoke 手机访问；范围必须是本桌面已授权集合的子集 |

## 调试客户端

先启动 Go Server，再使用源码目录中的客户端（不会打入 Connector 运行时包）：

```sh
export DSH_CONNECT_URL='http://127.0.0.1:8787'
export DSH_CONNECT_TOKEN="$DSH_CONNECT_BOOTSTRAP_TOKEN"

npm --prefix connector/dsh-plugin run debug -- pair-code
npm --prefix connector/dsh-plugin run debug -- devices
npm --prefix connector/dsh-plugin run debug -- list --device dev_xxx
npm --prefix connector/dsh-plugin run debug -- create --device dev_xxx --workspace workspace-id
npm --prefix connector/dsh-plugin run debug -- follow --device dev_xxx --session session-id --cursor 0
npm --prefix connector/dsh-plugin run debug -- prompt --device dev_xxx --session session-id --text '继续修复测试' --request-id req_stable_1
npm --prefix connector/dsh-plugin run debug -- page --device dev_xxx --session session-id --limit 50
npm --prefix connector/dsh-plugin run debug -- cancel --device dev_xxx --session session-id
```

`accepted` 仅表示 DSH 准入，完成必须等待对应 turn 的持久 `turn/end`。重复逻辑请求应复用相同 `--request-id`。

DSH `0.2.1-rc.5` 的 Host follow 不接受 resume cursor。外部 cursor 只记录客户端已确认水位，Connector 始终获取最新 opening snapshot（`recovery:'latest_snapshot'`），再按 `(sessionId,seq)` 去重或用 page 修复空洞；不会伪称 Host 从旧 cursor 回放。

## 测试

```sh
npm test
npm run test:e2e
```

- `npm test`：执行严格类型检查和 `tsc` 构建，再运行配对、权限、输入、游标、传输、Host DTO 和插件入口 TypeScript 单元测试。
- `npm run test:e2e`：执行类型检查后，构建并启动真实 Go Server，使用真实 Connector 协议/适配代码和可控 Host 仿真完成全闭环；它会自动清理临时 Server 和状态。

E2E 是协议与跨语言集成验证，**不是实际 DSH 生命周期或真实 Agent 执行验收**。实际 DSH smoke path 应为：

```text
create → follow snapshot → prompt(queue,稳定 requestId)
→ durable user/assistant/tool events → 对应 turn/end
→ 同 requestId 重试不重复 → cancel → 重连 snapshot 对齐
```

## P0 尚未包含

- APNs/FCM 推送；移动端当前通过轮询读取 transcript 与待处理审批。
- 附件、模型/Preset 完整选择和多实例 Server。
- 大于 64 KiB 的单帧工具输出分块；超限会明确报错并依靠 snapshot/page 恢复，不会静默丢弃。
- 系统安全存储中的设备密钥，以及 Connector 请求结果的持久化缓存。
