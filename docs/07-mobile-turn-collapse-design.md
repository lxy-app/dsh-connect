# 移动端会话消息分组与折叠方案

> **状态（2026-11-03）**：设计稿，未落代码。参照 WorkBuddy 的「已完成 / 深度求索中 + 步骤行」形态，解决 DSH Connect 移动端把一个 Turn 拆成多张卡片、且完全看不到执行步骤的问题。

## 1. 结论摘要

现在的移动端不是"折叠策略不对"，而是**缺少 Turn 这一层数据结构**：

1. Connector 每遇到一个 `assistant/message` 事件就投影成一条消息（`connector/dsh-plugin/src/lib/host-session-adapter.ts:275-315`），一个 Turn 里 N 段叙述 → N 条消息。
2. 移动端一条消息 = 一个气泡 + 一条页脚（朗读/时间）（`apps/mobile/src/features/session/chat-screen.tsx:1172-1275`），于是同一个 Turn 被拆成 3 张独立卡片，页脚重复 3 次。
3. 工具步骤被主动丢弃（`host-session-adapter.ts:291-294`），移动端只能在列表末尾留一句"已省略 N 个工具调用与输出"（`chat-screen.tsx:991-995`）。手机因此永远看不到"跑了什么命令、读了哪个文件"。

目标形态一句话：

> **一个 Turn = 一张卡片。卡片头部是「运行中 · 用时 X / 已完成 · N 步」的折叠条，折叠区里是逐条的单行步骤（思考 / 运行命令 / 读取 / 写入 …，每条还能再展开），最终回复永久可见、页脚只出现一次。**

分三步落地：M1 纯前端分组折叠（可立即见效）→ M2 实时步骤（WS 已带 `tool/call`，无需改协议）→ M3 历史步骤（Connector/Server/协议补字段）。

## 2. 现状与证据

| 环节 | 现状 | 证据 |
|---|---|---|
| DSH 会话日志 | 每个 Turn 有 `turn/start`、多段 `assistant/message`、成对 `tool/call`+`tool/result`、`turn/end` | `attachment-extract.ts:85-105` 已在读 `tool/call` 的 `name`/`callId`/`arguments` |
| Connector transcript | 一个 `assistant/message` → 一条消息；`tool/*` 直接丢弃 | `host-session-adapter.ts:291-315` |
| Connector 实时流 | 原样转发 `session.event`（含 `tool/call`/`tool/result`/`turn/start`） | `host-session-adapter.ts:442-461` |
| 移动端流处理 | 只对 `assistant/message`、`user/message`、`turn/end` 触发刷新，其余忽略 | `apps/mobile/src/lib/session-stream.ts:159-164` |
| 移动端渲染 | 每条消息一个气泡 + 一条页脚；>700 字才折叠，且折叠的是文本不是步骤 | `chat-screen.tsx:1188`、`:1238-1271` |
| 协议 | `MobileMessage` 只有 `text`/`toolName`/`toolCallId`，没有 Turn 归属 | `server/internal/protocol/types.go:448`、`apps/mobile/src/types/mobile.ts:144` |

顺带确认两个已具备的条件：

- `MobileTranscript` 已有 `active`、`turnEndSeq`（`apps/mobile/src/types/mobile.ts:158-168`），判断"这个 Turn 是否结束"不需要新字段。
- 长消息折叠、页脚朗读、附件挂载都是按消息粒度写的，分组后需要跟着改归属。

**待核实**：截图里两张只显示 `...` 的卡片，从代码里找不到占位实现（全仓库没有 `...`/`…` 占位渲染），推测是 DSH 记录的空文本或仅附件消息。M1 加一条"纯占位片段不单独成卡"的规则即可覆盖；若真实数据确认是 `role=tool` 的消息漏过滤，另开修复。

## 3. 目标形态（对齐 WorkBuddy）

### 3.1 完成态（默认折叠）

```
┌────────────────────────────────────────┐
│ ✓ 已完成 · 6 步 · 用时 2 分 13 秒   ⌄ │  ← 折叠条：整 Turn 一行
├────────────────────────────────────────┤
│ 最终回复（Markdown 全量渲染，不再折叠 │  ← 最终回复永远在折叠区外
│ 成 14 行纯文本预览）                   │
│                                        │
│ 🔊  13:14                              │  ← 页脚每 Turn 只有一次
└────────────────────────────────────────┘
```

### 3.2 完成态（展开步骤）

```
┌────────────────────────────────────────┐
│ ✓ 已完成 · 6 步 · 用时 2 分 13 秒   ⌃ │
├────────────────────────────────────────┤
│  ◇ 思考 · 先核实 selectModel 的写回…   │  ← 单行、右侧 chevron、点开才有详情
│  > 运行命令 · List modules and files   │
│  > 读取 · index.html                   │
│  > 运行命令 · Show git status, log…    │
│  > 写入 · modules/knowledge-assets/…   │
│  > 运行命令 · Count module lines       │
├────────────────────────────────────────┤
│ 最终回复 …                              │
│ 🔊  13:14                              │
└────────────────────────────────────────┘
```

### 3.3 运行态（自动展开、实时计时）

```
┌────────────────────────────────────────┐
│ ⟳ 深度求索中 · 用时 1 分 21 秒      ⌃ │  ← 计时来自 turn/start，逐秒刷新
├────────────────────────────────────────┤
│  … 已完成的步骤（同上，随流追加）       │
│  > 运行命令 · 拉取 pgvector:pg18 容器  │  ← 进行中的那一步显示为活动态
│  正在执行…                              │
└────────────────────────────────────────┘
```

### 3.4 单条步骤展开（点某一行）

```
│  ⌃ 运行命令 · 拉取 pgvector:pg18 容器   │
│  ┌──────────────────────────────────┐  │
│  │ docker compose up -d pgvector    │  │  ← 命令：超 2 行截断 + 「展开全部」
│  │ 容器 pgvector 已启动 (27.4.0)     │  │  ← 输出前 8 行
│  │ 耗时 12.4s · 成功                 │  │
│  └──────────────────────────────────┘  │
```

## 4. 折叠与分组规则

| 规则 | 结论 | 理由 |
|---|---|---|
| 分组键 | Turn：`user/message` → 下一条 `user/message` 之前 | 与桌面 DSH 的 Turn 语义一致；有 `turn` 字段时优先用它（跨分页安全） |
| 新建 Turn | 用户消息后立刻出现"深度求索中"折叠条，不加第二张占位卡 | 取代现在的独立等待气泡（`chat-screen.tsx:958-989`） |
| 完成态默认 | 折叠 | WorkBuddy 同款；长会话可扫读 |
| 运行态默认 | 展开，且滚到底时跟随最新一步 | 正在跑的时候要看得见进展 |
| 用户手动操作 | 记住当前 Turn 的手动状态，直到离开页面；Turn 结束**不**强制覆盖 | 避免"我展开着它自己收起来" |
| 最终回复 | 永远在折叠区外；折叠区只放中间过程 | 用户要的是结论 |
| 折叠区内容 | 叙述片段 + 步骤行按发生顺序混排 | 保留因果（"我先看 A` → 读取 A → "A 有问题"） |
| 空片段 | 去空白后 ≤3 字符且无附件：不单独成卡，直接丢弃 | 覆盖截图里的 `...` 卡片 |
| 长文本 | >700 字的折叠规则只作用于**最终回复**，不再逐片段生效 | 现在每个片段都长消息折叠很吵（`chat-screen.tsx:1188`） |
| 页脚 | 每 Turn 一次：朗读读最终回复，时间取 Turn 内最后一条消息 | 现在 3 张卡 3 条页脚 |
| 附件 | 挂到该 Turn 的最终回复卡上（沿用 `#mountAttachment` 的 turn 归属） | 已有 Turn 归属逻辑，不重写 |
| 分页 | 首条不完整的 Turn 仍可渲染，头部标注"以上步骤已折叠/向上加载更早" | 游标可能切在 Turn 中间 |

## 5. 数据契约：三个方案

### 方案 A：纯前端分组（M1，零协议改动）

- 按 user 消息边界把 assistant 消息分组成 Turn，折叠条显示"N 段过程 · 用时 X"。
- 折叠区里只有叙述片段，**没有工具步骤**。
- 收益：立刻解决"拆开"+页脚重复，1 个 PR；成本最低。
- 局限：仍然看不到 `运行命令`/`读取`，与 WorkBuddy 的差异只补了一半。

### 方案 B：实时步骤（M2，仅改移动端）

- WS 已经原样转发了 `tool/call`/`tool/result`（`host-session-adapter.ts:442-461`），移动端在 `session-stream.ts` 里解析即可，**三端零协议改动**。
- 步骤行信息：`name` + 从 `arguments` 里抽一条安全摘要（命令首行 / 文件名 / 查询串）+ 完成状态 + 耗时（`tool/call` → `tool/result` 的 `occurredAt` 差）。
- 局限：只在**实时**时出现；重新进入会话、翻历史时步骤消失 → 历史与实时表现不一致，必须配 M3。

### 方案 C：历史步骤（M3，Connector + Server + 协议）

在 `MobileMessage` 上增加可选字段（向后兼容，老 Connector 不填就是老行为）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `turn` | `int` | Turn 序号，Connector 已有 `currentTurn` 可直接填 |
| `role` | 增加 `"tool"` | 工具步骤作为独立消息下发 |
| `stepKind` | `string` | `think` / `command` / `read` / `write` / `search` / `fetch` / `approve` |
| `summary` | `string` | 单行摘要，≤120 字，**已是脱敏后的展示文本** |
| `status` | `string` | `running` / `ok` / `error` |
| `durationMs` | `int` | 可选 |
| `detail` | `string` | 可选，≤2 KB；展开时才有意义 |

配套约束（与附件方案同一条边界）：

- **路径不出桌面**：`detail` 里的绝对路径必须转成 workspace 相对路径，与 `docs/06-mobile-attachments-design.md` 的约定一致。
- **凭据要掩码**：`arguments`/输出里命中 `sk-…`、`Bearer …`、`apiKey=…`、`.env` 值等模式时替换为 `***`。
- **预算**：单条 `detail` ≤2 KB，整份 transcript 的 `detail` 合计 ≤8 KB，超出降级为只发 `summary`（总载荷上限 64 KiB 是硬约束，见 `docs/06-mobile-attachments-design.md` 第 2 节）。
- **工具白名单**：与 `attachment-extract.ts` 的 allowlist 思路一致，未知工具只发 `name`，不发 `arguments`。

改造点：

1. `connector/dsh-plugin/src/lib/host-session-adapter.ts:275-315`：把 `tool/call`+`tool/result` 配对投影成步骤消息（callId 配对，`isError` → `status: 'error'`），并给所有消息补 `turn`。
2. `server/internal/protocol/types.go:448`：`MobileMessage` 增字段；`protocol/schemas/v1/mobile.schema.json:719` 与 `protocol/openapi.yaml:519` 同步。
3. `apps/mobile/src/types/mobile.ts:144`、`apps/mobile/src/lib/mobile-api.ts:655-665`：解析新字段（严格解码、缺省即老行为）。
4. Server 侧目前是纯透传（`server/internal/server/mobile_access.go:414-470`），不需要逻辑改动，只跟着协议 DTO 走。

**建议**：A → B → C 顺序落地，A 与 B 可以在一个 PR，C 单独 PR 并跑 `make test-e2e`。

## 6. 移动端实现要点

新增/改动（`apps/mobile/src/features/session/chat-screen.tsx`）：

1. 抽 `lib/turn-grouping.ts`：`groupTurns(messages) => TurnGroup[]`，纯函数、可 Node 单测（与 `lib/pending-reply.ts` 一样的可测风格）。
   `TurnGroup = { key, turn?, messages, steps, final, startedAt, endedAt?, running }`。
2. 渲染从 `conversation.map(MessageRow)`（`:921-934`）改为 `groups.map(TurnCard)`；用户消息仍走现有气泡。
3. 新组件 `TurnCard`（建议放 `components/turn-card.tsx`）：
   - 折叠条：运行中 `⟳ 深度求索中 · 用时 X`（复用 `nowTick` 的秒级刷新，`:440-456` 已有心跳），完成 `✓ 已完成 · N 步 · 用时 X`；整条可点，`accessibilityRole="button"` + `accessibilityState={{ expanded }}`。
   - 步骤行：icon（沿用 `components/chat-icon.tsx`，缺 `read`/`write`/`search` 就补）+ 动词 + 单行摘要 + chevron；`numberOfLines={1}`。
   - 步骤详情：`Pressable` 展开，命令用等宽 `Text`，输出前 8 行 + "展开全部"（一次最多再放 200 行）。
4. 页脚下沉到 `TurnCard`：朗读只读 `final` 文本（`speak(markdownToPlainText(turn.final.text))`），`key` 用 `turn-${turn}-final`，避免现在按 `message.seq` 分键（`:1277-1279`）导致同 Turn 多次朗读。
5. 删除 `hiddenToolCount` 与那句"已省略"文案（`:438`、`:991-995`）；`role: 'tool'` 不再被过滤掉（`:431-437`），而是变成步骤行。
6. 自动播报（`:480-497`）：从"最后一条 assistant 消息"改为"最后完成的 Turn 的 final"，否则播报会被中间片段触发。
7. 性能：折叠使默认渲染的节点更少；展开的步骤详情按 Turn 懒渲染，避免长会话一次性铺开。

新增/改动（`apps/mobile/src/lib/session-stream.ts`）：新增 `onStep` 回调，把 `session.event` 里的 `tool/call`（开始）与 `tool/result`（结束）转成步骤增量；`turn/start` 记录开始时间。

## 7. 原型先行

改 `prototype/dsh-connect-prototype.html`：

1. `messageHtml()`（第 369 行）增加 `turn` 类型分支：渲染折叠条 + 步骤行 + 最终回复，替代现在 `tool-card` 的独立卡片。
2. 新增 `.turn-head` / `.turn-steps` / `.step-row` / `.step-detail` 样式，沿用现有 `--surface` / `--border` / `--brand` 变量与 14px 圆角。
3. `sessionMessages` 里造一条含 6 步的 Turn，默认折叠；点击折叠条切换展开；点击单步行切换详情。三个状态（运行中 / 已完成折叠 / 已完成展开）都要能点到。

## 8. 验收清单

- 同一 Turn 只出现一张卡片、一条页脚；页脚朗读只读最终回复。
- 完成态默认折叠，点击展开/收起；运行态默认展开并跟随最新步骤。
- 步骤行单行不换行；点开能看到命令与截断后的输出；失败步骤显示错误色与 `error` 状态。
- `...` 之类的占位片段不再单独成卡。
- 重新进入会话、翻历史、翻页边界处步骤都在（M3 后）。
- 断线重连后步骤不重复、不丢失（以 `(sessionId, seq)` 去重）。
- 老 Connector（无 `turn`/`stepKind`）连新 App：退化为"按 user 消息分组 + 只有叙述片段"，不崩、不空白。
- 载荷不超 64 KiB：长 Turn 的 `detail` 预算生效。
- 通过 `npm --prefix apps/mobile run check`；Connector 侧补步骤投影单测并通过 `make test-connector`；改协议后跑 `make test-e2e`。

## 9. 待确认

1. **步骤详情要不要默认下发**：默认发（体验好、离线可看，但要脱敏 + 预算）还是点开时再按需拉（多一次 RPC，但暴露面最小）？我倾向默认发，`detail` 走脱敏 + 8 KB 预算。
2. **运行态是否自动展开**：WorkBuddy 是展开的；如果希望手机更安静，也可以运行态只显示折叠条 + 一行"正在执行 …"，完成后保持折叠。
3. **思考（reasoning）要不要显示**：截图里 WorkBuddy 有 `思考` 行。DSH 的 reasoning 属于中间过程，是否允许下发到手机需要单独确认（安全与产品口径都不同）。