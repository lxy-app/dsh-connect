# 移动端会话模型切换方案

> **状态（2026-11-06）**：已按 DSH `0.2.2-rc.1` 复核并切换方案。原决策 A（等待 `selectModel({ persistDefault: false })`）的上游参数**未落地**，但 DSH 当前公开的 Host Agent API 已能实现「只改当前会话，不改桌面默认模型」。现改为 **Connector 组合 `resolveAgent + llm 校验 + agent.model.select`**，不再等待上游，也不采用写回旧默认值的补偿方案。P0 + P1 产品代码已按本方案落地，验证结果与真实 Host 待验项见第 8 节；原型仅用于交互对照，未替代产品实现。

## 1. 结论摘要

移动端切换模型的产品约束仍是：**只改当前会话，不改桌面默认模型**。

DSH `0.2.2-rc.1` 的 `sessionController.selectModel` 仍会在会话选择后无条件调用 `agentDefaultModel.saveSelection()`，其请求类型和两套 schema 也仍没有 `persistDefault`。因此，原方案不能按「传一个开关」实施。

但这次不需要退回有风险的读改写补偿。当前 Host 已提供另一条公开路径：

1. `sessionController.resolveAgent(sessionId)` 为其他 Host API 域解析或恢复普通会话；
2. `ctx.llm` 提供模型目录与调用配置校验；
3. `agent.model.select(selection)` 只追加当前 Session 的 `model/selection` 事件。`@deepseek-ai/dsh-agent` 的官方包文档明确说明：**选择 Session 模型不会改变部署默认值，调用方负责校验可用性与能力**。

新方案的一句话结论：

> **P0 用 `modelCatalog + projections` 只读目录和会话模型，不唤醒冷会话；P1 由 Connector 校验选择后直接调用公开 `agent.model.select`，全程不调用 `sessionController.selectModel`，也不调用 `agentDefaultModel.saveSelection`。**

## 2. DSH 0.2.2-rc.1 复核证据

### 2.1 原 `persistDefault` 提案未支持

本次直接读取当前安装包 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh`，版本来自根 `package.json` 与相关包自身的 `package.json`，均为 `0.2.2-rc.1`。

| 核查项 | 0.2.2-rc.1 实际结果 | 证据 |
|---|---|---|
| 请求类型 | `SessionSelectModelRequest` 仍只有 `sessionId` 与 `ModelSelection`，无 `persistDefault` | `dsh-api-session-controller/lib/typert.host.js:3795-3796` |
| 宽松 codec | 仅 `sessionId/provider/model/reasoningEffort` | `lib/typert.host.js:1519-1524`；JSON Schema 仍为 `additionalProperties: true`（`:2493`） |
| 严格 codec | 字段完全相同，仍无 `persistDefault` | `lib/typert.host.js:1790-1795`；JSON Schema 为 `additionalProperties: false`（`:2499`） |
| Remote 方法 | 模型切换仍是 `session/selectModel`，没有独立 `selectSessionModel` 变体 | `lib/typert.host.js:2480-2510` |
| 会话选择 | 已改为公开 `agent.model.select(selected)` | `dsh-api-session-controller/lib/index.js:704-715` |
| 默认写回 | 紧接着仍无条件执行 `agentDefaultModel.saveSelection(selected)` | 同上，`:716-718`；包文档也说明默认保存在后台进行（`README.zh.md:95`） |
| 实际落盘能力 | `saveSelection` 仍通过 `configEditor.edit` 保存 | `dsh-agent-default-model/lib/index.js:53-65` |

结论：**不能向 0.2.2-rc.1 乐观透传 `persistDefault: false`。** 宽松路径可能静默忽略它，严格路径会拒绝它，两种路径都不满足安全切换要求。

### 2.2 可替代上游提案的公开 Host 能力

| 能力 | 当前语义 | 证据 |
|---|---|---|
| `sessionController.resolveAgent` | 面向其他 Host API 域解析或恢复普通 Session，返回 `{ agent }` 或 `{ error }`；不是新的 Remote 模型方法 | `dsh-api-session-controller/lib/typert.host.js:2695-2700`、`:2931-2936`，实现 `lib/index.js:3882-3884` |
| `agent.model.current/select` | 公开 Agent API；`select` 记录完整 Session 选择，不改变部署默认值，可用性校验由调用方负责 | `dsh-agent/README.zh.md:45-54` |
| `model/selection` 持久事件 | `AgentModel.select` 仅在值变化时 `session.append('model/selection', …)`，没有默认模型写回 | `dsh-agent/lib/index.js:181-204` |
| `llm.listProviders/listModels` | 校验精确 provider/model 是否仍在当前可用目录 | `dsh-llm/lib/typert.host.js:163-169`、`:234-238` |
| `llm.resolveCallConfig` | 校验精确模型能力与显式 reasoning effort | 同上，`:247-252`；实现 `dsh-llm/lib/index.js:2169-2184` |
| `modelSelection` 投影 | 返回 `lastUsed` 与 `next`，可从持久 Session 读取，无需激活 Agent | `dsh-agent/lib/index.js:140-173`；`dsh-api-session-controller/lib/index.js:1827-1867` |

这说明原提案所追求的效果已经能通过**公开 Host API 组合**实现，而不是通过 `selectModel` 的可选参数实现。

## 3. 方案比较与决策

| 方案 | 做法 | 结论 |
|---|---|---|
| A：等待 `persistDefault` | 上游给 `selectModel` 加开关，Connector 透传 `false` | **退出阻塞方案**。0.2.2-rc.1 未支持；未来若落地可作为简化适配，但不再是前提 |
| B：默认值补偿 | 读旧默认 → `selectModel` → 写回旧值 | **继续否决**。非原子、产生额外 profile 写入与备份，崩溃会残留，并可能覆盖桌面并发修改 |
| **D：公开 Host Agent API** | `resolveAgent` → `llm` 校验 → `agent.model.select` | **采用**。不写部署默认，不需要上游变更，语义与公开 Agent API 一致 |

不采用「把模型塞进 `session.prompt`」：模型选择是独立的会话级持久意图，塞进单次提示词会混淆命令语义与 `requestId` 幂等边界。线上协议继续使用独立 `GET/POST …/model`，DSH Host 内则由 Connector 选择正确的公开 API。

## 4. 目标链路

### 4.1 P0：只读模型目录与当前会话模型

```text
Mobile GET /v1/mobile/sessions/{id}/model
  → Server：read scope + session/workspace 授权
  → Connector session.model.catalog
      ├─ sessionController.modelCatalog()             # default + 目录，不激活 Session
      └─ sessionController.projections({ sessionId }) # modelSelection，不激活 Agent
  → Mobile 展示 effective/default/groups/failures
```

`modelCatalog()` 在 0.2.2-rc.1 的返回是 `{ default, routableProviders, groups, failures }`，**不包含当前 Session 的选择**。`projections()` 的 `values.modelSelection` 返回 `{ lastUsed, next }`。因此移动端有效模型应按下面规则计算：

```ts
effective = projections.values.modelSelection?.next ?? catalog.default;
```

建议响应结构：

```ts
{
  sessionId: string;
  deviceId: string;
  workspaceId: string;
  default: ModelSelection;
  lastUsed: ModelSelection | null;
  next: ModelSelection | null;
  effective: ModelSelection;
  routableProviders: readonly string[];
  groups: readonly ModelProviderGroup[];
  failures: readonly ModelCatalogFailure[];
  projectionKind: 'sequenced' | 'migration-required';
}
```

`migration-required` 分支的投影只是缓存提示，不能当作精确当前值。UI 应标记数据可能过期，并在切换前要求先在桌面完成迁移；不要把它静默当作 `sequenced`。

### 4.2 P1：会话级切换

```text
Mobile POST /v1/mobile/sessions/{id}/model
  → Server：prompt scope + 严格解码 + 持久幂等 + 审计
  → Connector session.model.select
      ├─ 再次校验真实 session → workspace 归属与 prompt scope
      ├─ projections 前置检查：migration-required 则失败关闭
      ├─ sessionController.resolveAgent(sessionId)
      ├─ llm.listProviders/listModels：精确 provider/model 必须仍可用
      ├─ llm.resolveCallConfig(selection, signal)：校验 reasoningEffort/能力
      ├─ signal.throwIfAborted()
      └─ agent.model.select(selection)                # 只写 Session 事件
  → 返回 selected，并由持久 model/selection 事件校正其他客户端
```

Connector 必须先做投影前置检查；若为 `migration-required`，返回明确的 `session_migration_required`，不能只靠 UI 禁用。调用 `resolveAgent` 后必须显式处理其判别联合：遇到 `{ error }` 时抛出该错误，不能把返回值直接当成 Agent。模型目录或能力校验失败映射为明确的 `model_unavailable`，不追加选择事件。

**禁止出现以下调用：**

- 不调用 `sessionController.selectModel`，避免默认模型后台写回；
- 不调用 `agentDefaultModel.saveSelection`，避免 Connector 自行改部署默认；
- 不读写 `cordis.patch.yml`，不实现任何默认值恢复逻辑。

## 5. 我们侧的适配点

### 5.1 Connector

1. `host-api.ts` 增加 0.2.2-rc.1 的最小结构类型：`ModelSelection`、`ModelCatalog`、`SessionProjectionsValue`、`resolveAgent`、`HostAgent.model`、`LlmRuntime`。
2. `HostContext` 与插件 `inject` 增加 `llm`；版本敏感契约仍集中在 `host-api.ts`，不让 Host Agent 对象泄漏到 Server 或线上协议。
3. `host-session-adapter.ts` 增加 `model.catalog` 与 `model.select`，两者都先执行现有 `#authorizeSession`；写操作使用 `prompt` scope。
4. `command-handler.ts` 增加 `session.model.catalog` / `session.model.select` 白名单与参数校验。
5. 对移动端 `prompt` 与 `model.select` 增加同一 sessionId 的串行链，避免 Connector 自己并发执行图片提示词准入与模型切换。
6. 错误保持可映射：`session/not-found`、`session/writer-held`、`session/model-unavailable`、取消与超时不得被吞掉。

### 5.2 Server 与协议

1. v1 内新增 `GET /v1/mobile/sessions/{sessionId}/model` 与 `POST` 同路径；同步 OpenAPI、v1 JSON Schema、Connector 方法常量和 Mobile 类型。
2. GET 复用 `read`，POST 复用 `prompt`，不新增 scope；REST 输入严格拒绝未知字段。
3. `session.model.select` 必须加入 `Router.Execute` 的**持久幂等分支**，不能只加入方法白名单。当前只有 `session.create/session.prompt` 进入该分支（`server/internal/server/router.go:49-79`）。URL 中的 `sessionId` 必须进入 Connector command params，从而参与 `requestHash`，不能只存在于路由路径。
4. 更新 `IdempotencyRecord` 注释与测试，使其覆盖模型选择。Connector 的 `RequestCache` 只是进程内 at-most-once 第二道防线，不能替代 Server 重启后仍可查询的持久结果。
5. POST 审计使用独立动作 `mobile.session.model.select`，不记录任何凭据或 provider 失败响应中的敏感细节。

持久幂等不能仅依赖 `AgentModel.select` 的「相同选择不重复追加」：在 A → B → A 或超时后重试场景下，请求身份必须由稳定 `requestId` 判断，而不是靠最终模型值猜测。

### 5.3 Mobile

1. 新增模型 Provider/弹层，复用已确认的原型交互；有效模型使用 `effective`，偏离 `default` 时显示标记。
2. P0 只读阶段隐藏或禁用切换动作；P1 接入 POST，并以同一 `requestId` 处理不确定结果重试。
3. `session-stream.ts` 目前只在 `assistant/message/user/message/turn/end` 时刷新（`:159-164`）。P1 必须处理 `model/selection`，更新模型状态或触发模型目录刷新；仅新增 WSS 事件转发还不够。
4. 生效文案与 Host 语义保持一致：「仅当前会话，不修改桌面默认模型；已经准备的步骤保持不变，后续尚未准备的步骤使用新模型。」空闲会话下一条消息会使用新模型，但运行中不能笼统承诺整条后续 Turn 都立即切换。

## 6. 分阶段落地

| 阶段 | 内容 | 上游依赖 |
|---|---|---|
| **P0：只读** | `modelCatalog + projections`、GET 协议、Mobile 当前模型与目录展示 | 无，0.2.2-rc.1 已具备 |
| **P1：切换** | POST、Server 持久幂等、Connector `resolveAgent + llm + agent.model.select`、Mobile 事件刷新 | 无，0.2.2-rc.1 已具备 |
| **P1-gate：真实 Host 验收** | 默认值不变、冷会话、重启、并发图片提示词、真实 Agent 请求头 | 必须通过后才能宣称可发布 |

实现已按协议 → Connector → Server → Mobile 的顺序落地，并补跨层 E2E；原型没有被当成真实功能完成凭证。

## 7. 风险与验收标准

| 风险/边界 | 处理与验收 |
|---|---|
| 默认模型被误改 | 单元测试用 spy 证明不调用 `selectModel/saveSelection`；真实 DSH 中切换前后 `modelCatalog().default` 与桌面默认保持不变，重启后仍不变 |
| 模型在校验后变化 | 写操作时重新列目录并 `resolveCallConfig`，不能只信 P0 缓存；失败不得追加 `model/selection` |
| 冷会话被唤醒 | 仅 P1 调 `resolveAgent`；覆盖恢复成功、`not-found`、`writer-held`，P0 不得激活 Agent |
| 图片提示词与切换竞态 | Connector 内同 sessionId 串行化；真实 Host 必须覆盖桌面图片 prompt 与移动端切换并发。直接 Agent API 不复用 `selectModel` 私有的 `serializeImageAdmission`，若该竞态无法被验收接受，则 P1 失败关闭并重新请求上游暴露组合入口，绝不改用方案 B |
| 重复/不确定重试 | 覆盖同 `requestId` 同参数返回同一结果、不同参数 `idempotency_conflict`、Server 重启后恢复结果、Connector 超时不盲发新 requestId |
| 运行中生效语义 | 验证已经准备的 step 保留旧模型，后续尚未准备的 step 使用新模型；以下一次 `request/header` 和持久事件为准 |
| 桌面与移动端同时切换 | 以 Session Log 的事件顺序为准，Mobile 收到 `model/selection` 后校正；不得用本地乐观状态覆盖更新的 seq |
| 目录含提供方失败原因 | 仅透传展示所需的提供方名与安全原因，不带凭据、设置值或内部路径 |

## 8. 验证结果与剩余验收

### 8.1 已完成

- 上游核查：安装包静态源码与包文档确认原 `persistDefault` 提案在 0.2.2-rc.1 未支持，公开 `agent.model.select` 不改变部署默认。
- 协议：v1 JSON Schema 与 OpenAPI/AsyncAPI YAML 语法检查通过。
- Server：`go vet ./...` 与全部 Go 测试通过；模型用例覆盖 read/prompt 授权、严格解码、完整 params、409 错误、同请求重放、参数冲突、Server 重启恢复和撤销后失败关闭。
- Connector：类型检查、构建与 109 项单元测试通过；覆盖只读不唤醒 Agent、直接 AgentModel 选择、无效模型不落事件、迁移失败关闭和 prompt/切换串行。
- 跨层 E2E：真实 Go Server + Connector + 可控 Host 通过，覆盖模型目录、Session-only 切换、默认模型不变、`model/selection` 事件和幂等重放。
- Web/Mobile：Admin TypeScript 检查通过；Mobile ESLint、TypeScript 与 47 项单元测试通过；iOS/Android 生产 JS bundle 导出成功（不等同于原生构建或真机验收）。
- 全程未修改任何 DSH profile，也没有通过读改写恢复默认模型。

### 8.2 尚未执行，仍是发布门槛

1. **真实 DSH Host**：切换前后及重启后的 `modelCatalog().default` 与桌面默认保持不变；冷会话恢复、`writer-held`、下一次 `request/header` 和持久事件符合预期。
2. **图片准入并发**：覆盖桌面图片 prompt 与移动端切换并发。直接 Agent API 不复用 `selectModel` 私有的 `serializeImageAdmission`；若该场景不能安全验收，P1 必须失败关闭并重新请求上游组合入口，不能退回方案 B。
3. **Development Build 真机**：只读可看不可切、prompt 可切模型与强度、加载/错误/空目录/迁移状态、跨会话隔离、不确定重试同 requestId、后台恢复与桌面并发切换。

因此，当前结论是**方案 D 的 P0 + P1 已实现并通过分层与仿真验证**，但不能把上述结果描述成真实 DSH 生命周期、真实 Agent 请求或真机验收已经通过。上游 `persistDefault` 不再是阻塞项；若未来上游提供同等的公开会话级组合命令，可再简化 Connector，并优先复用其串行化语义。
