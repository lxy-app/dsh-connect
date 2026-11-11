# AGENTS.md

本文件面向在本仓库中工作的编码代理。修改 `apps/mobile/`、`apps/mobile-harmony/` 或 `apps/mobile-shared/` 时，还必须遵守对应目录下更具体的 `AGENTS.md`。

## 项目概览

DSH Connect 让移动端通过 Go Server 远程查看和推进桌面 DeepSeek Harness（DSH）会话，并提供 Web 管理后台、桌面 Connector、配对授权、远程审批和审计能力。

这不是单一应用或根级 npm workspace：Go Server 与四个独立 npm 工程分别构建和测试；`apps/mobile-shared/` 是两端共享的源码目录，不是独立 npm 工程。

```text
apps/admin/                  React 19 + Ant Design 6 + Vite 8 管理后台
apps/mobile/                 Expo SDK 58 + React Native iOS/Android App
apps/mobile-harmony/         Expo SDK 55 + RNOH 0.84.1 鸿蒙运行时壳
apps/mobile-shared/          双端共享 TS/TSX 源码；通过 @shared/* 引用
connector/dsh-plugin/        实际 DSH Connector、桌面面板与调试客户端
protocol/                    v1 OpenAPI、AsyncAPI 与 JSON Schema 契约
server/cmd/server/           Go Server 入口
server/internal/protocol/    版本化 wire DTO 与错误模型
server/internal/server/      REST/WSS、Hub、认证、授权与事件中继
server/internal/store/       PostgreSQL/SQLite + ent 持久化
server/ent/schema/           ent schema（手写）
server/ent/                  ent 生成代码（除 schema 外不要手改）
docs/                        架构、产品、实施路线与验收说明
prototype/                   独立 HTML 交互原型（产品 + 官网），不连接真实服务
```

实现真实功能时不要改原型代替产品代码。详细说明优先查阅根目录及各组件的 `README.md`。

## 工具链与依赖

- Go 版本以 `server/go.mod` 为准，当前为 **Go 1.26.0**。
- `entgo.io/ent` 当前指向含 Go 1.27 代码生成修复的 master 伪版本；升级与退场条件见 `server/README.md` 的 ent schema 小节，改动 `ent/schema/` 前先确认生成器版本与 go.mod 一致。
- 使用 **Node.js 24**；Connector 的 `engines.node` 明确要求 `>=24`。
- 默认数据库为 **PostgreSQL 18**，单实例可选择 **SQLite**；PostgreSQL 集成测试需要 Docker，SQLite 测试使用临时文件。
- Connector 兼容 **DSH `0.2.2-alpha.2` / `0.2.2-rc.1`**。升级 DSH 后必须核对 Host 方法签名、事件 DTO、插件生命周期和真实 Agent 闭环，不能只改版本号。
- 各 npm 工程有独立 `package-lock.json`。在对应目录使用 `npm ci` 或 `npm install`，不要假设根目录能执行 npm 脚本。
- 新增或升级 Expo 原生模块时，在对应 App 目录使用 `npx expo install <package>`，不要直接用普通 `npm install <package>` 选择版本。
- 主线 Mobile 当前为 **Expo SDK 58**，鸿蒙壳固定为 **Expo SDK 55 + RNOH 0.84.1**。两端独立 lockfile；不要为对齐版本让主线降级，也不要让鸿蒙壳自动跟随主线升级。
- `.env`、令牌、设备凭据和签名材料均属于本地秘密；不要读取后展示、写入日志或提交。配置模板见 `.env.example`。

## 常用命令

在仓库根目录执行：

```sh
# 本地运行
make db-up                 # 启动默认 PostgreSQL 18，保留数据卷（SQLite 不需要）
make run-server            # 自动迁移并引导 Owner，默认 127.0.0.1:8787
make admin-install
make run-admin             # Vite：http://127.0.0.1:5173
make mobile-install
make run-mobile            # iOS/Android Expo Metro；需要 Development Build
make mobile-harmony-install
make run-mobile-harmony    # 鸿蒙 Metro；需要 DevEco/RNOH 环境与 HAP

# 分层验证
make vet                   # go vet ./...
make test-server           # Go 单元/集成测试
make test-connector        # Connector 类型检查、构建与 Node 测试
make test-e2e              # 真实 Go Server + Connector + 可控 Host 仿真
make test-admin            # Admin TypeScript 检查
make test-mobile           # 主线 Mobile ESLint + TypeScript + 单元测试
make test-mobile-harmony   # 鸿蒙壳 ESLint + TypeScript
make test                  # Server + Connector
make check                 # 上述完整静态检查与测试组合

# 构建与代码生成
make admin-build           # Admin 类型检查 + 生产构建
make mobile-build          # 导出 iOS/Android JS bundles，不等于原生构建
make mobile-harmony-build  # 构建鸿蒙 HAP；需先 setup:native，签名材料另配
make ent-gen               # 修改 ent/schema 后重新生成并 gofmt
```

常用的定向命令：

```sh
go -C server test ./internal/server -run TestName
go -C server test ./...
npm --prefix connector/dsh-plugin run typecheck
npm --prefix connector/dsh-plugin test
npm --prefix apps/admin run build
npm --prefix apps/mobile run check
npm --prefix apps/mobile-harmony run check
npm --prefix apps/mobile-harmony run setup:native
```

Server 测试由 `internal/dbtest` 选择数据库，`make test-server` 会用同一套用例分别运行 PostgreSQL 和 SQLite。PostgreSQL 通过 `internal/pgtest` 自动启动临时 18 容器，每个测试使用独立数据库；没有 Docker 时相关测试可能跳过，CI 或必须执行时设置 `DSH_CONNECT_REQUIRE_PG=1`，可用 `DSH_CONNECT_TEST_DATABASE_URL` 复用已有实例。SQLite 使用独立临时文件，不需要 Docker。

`make db-reset` 会删除数据库数据卷，属于破坏性操作；未经用户明确确认不要执行。

## 编码约定

### 通用

- 保持改动聚焦，遵循附近代码的命名、错误处理和文件组织，不顺手重构无关代码。
- 不要覆盖或回退用户已有的未提交修改；需要触碰相关区域时先理解现状。
- 不手工编辑构建产物（如 `dist/`）或带 `Code generated ... DO NOT EDIT` 标记的文件。
- 行为变化应补充或更新对应层测试；用户可见行为、配置或验证状态变化时同步相关 README/文档。

### Go Server

- 修改 Go 文件后运行 `gofmt`；至少执行相关包测试，提交前按影响范围运行 `make vet` 和 `make test-server`。
- DSH 相关类型放在 Connector，稳定线上协议 DTO 放在 `server/internal/protocol/`，不要把 Host API 泄漏进 Server。
- 数据持久化使用 PostgreSQL（默认）或单实例 SQLite + ent，共用同一套 schema 和 Store；SQLite 不启用多副本或网络文件系统。只手改 `server/ent/schema/`，随后运行 `make ent-gen`；不要手改其余 `server/ent/` 生成文件。
- Server 不直接读取 DSH 文件，也不保存会话正文。
- 新增 REST 输入时保持严格解码：未定义字段应被拒绝，而不是静默忽略。

### Connector

- 源码与测试均为严格 TypeScript；当前配置启用 `noUncheckedIndexedAccess`、未使用检查等约束。
- Host 版本敏感契约集中在 `src/host-api.ts`，Connector 协议 DTO 集中在 `src/types.ts`，适配逻辑放在 `src/lib/`。
- ESM 源码中的相对导入沿用 `.js` 后缀风格。
- Cordis 加载的是构建后的 `dist/` JavaScript。保留构建末尾的 `scripts/strip-client-export.mjs`：Web Client 由经典脚本加载，移除该步骤会导致 `export {}` 语法错误。
- 测试位于 `test/`，通过 TypeScript 构建后由 `node --test` 执行；调试客户端和测试不进入运行时发布物。

### Web Admin

- 页面按路由使用 `React.lazy` 分包。
- 不要给 antd/rc 配置手动 vendor 分组或 `maxSize` 切包；当前 rolldown 会产生循环 chunk 并导致生产白屏，共享 chunk 交给默认算法。
- 前端权限隐藏只用于体验，真实权限必须由 Server 强制。
- `npm run lint` 当前实际也是 TypeScript 检查；生产改动还应运行 `npm run build`。

### Mobile

- 分别遵守 `apps/mobile/AGENTS.md`、`apps/mobile-harmony/AGENTS.md` 与 `apps/mobile-shared/AGENTS.md`；Expo/RN API 必须查阅与目标壳 SDK 匹配的文档，不凭旧经验猜 API。
- **一套共享业务源码 + 两个运行时壳**：通用类型、业务逻辑和可复用 UI 放 `apps/mobile-shared/`；平台路由、原生能力和补丁放各自 App。不要维护两条长期 Git 业务分支。
- 共享引用统一使用 `@shared/*`，共享目录内部优先相对导入；不在共享目录直接 import 带原生实现的 Expo 模块，也不写平台分叉。
- 路由只放在各 App 的 `src/app/`，使用 Expo Router；组件、hooks、provider 和业务逻辑放在对应非路由目录。
- 不手工编辑 CNG 生成的 `ios/`、`android/`、`harmony/`；原生行为通过 app config、config plugins 和可重复脚本配置。新增原生模块或修改原生配置后重新构建对应原生包。
- Token 和云厂商密钥只能保存在 SecureStore/内存中，不进入日志、SQLite、导航参数或 `EXPO_PUBLIC_*`。
- 完成移动端改动前分别运行相关 App 的 `npm run check`；共享代码还需运行主线 `npm test`、主线 `build:bundles` 和鸿蒙壳检查。JS bundle、静态检查均不能替代真机或原生构建验收。

## 协议与跨组件修改

线上协议当前为 **v1**，WebSocket 信封使用 `v: 1`。修改契约时按实际影响同步检查：

1. `protocol/openapi.yaml`、`protocol/asyncapi.yaml`、`protocol/schemas/v1/`。
2. `server/internal/protocol/` 及 Server 校验、路由和测试。
3. `connector/dsh-plugin/src/types.ts`、命令/事件适配与测试。
4. `apps/mobile-shared/types/`、两端 API/stream 客户端，以及 Admin 类型和调用方。
5. 跨语言 E2E、协议 README 和相关用户文档。

保持向后兼容和错误语义明确，不要只改某一端类型后假定其他端自动一致。

## 必须保持的架构与安全边界

- **DSH Session Log 是会话事实源。** 只能由 Connector 通过 DSH Host API 获取会话与事件；Server/App 不得直接读取 DSH 内部文件。
- **默认拒绝。** 桌面显式授权工作区和 scopes；手机配对本身不授予桌面权限。Server 校验 mobile grant，Connector 再校验真实 session → workspace 归属。
- 移动 Access Token 只能访问受 grant 约束的 `/v1/mobile/*`，不能访问 bootstrap 调试接口。
- `read`、`prompt`、`cancel`、`approve` 分离；不要引入任意 `cwd`、任意 Shell 或隐式永久授权。
- `session.prompt` 全链路使用稳定 `requestId` 幂等。`accepted` 只表示 DSH 准入，完成必须等待对应持久 `turn/end`；不确定结果的重试不得生成新 requestId 盲目重发。
- 持久事件 `(sessionId, seq)` 与临时 `assistant.stream` 坐标不可混用。恢复时获取 opening snapshot，按序去重并用 page 修复空洞；unfollow 必须匹配自己的 `followId`，避免误杀新订阅。
- 远程审批/提问是一次性、失败关闭的操作：只允许明确决定，超时、离线、撤回或协议错误不得伪造批准；手机与桌面不能同时保留可答副本。
- 配对码、Access/Refresh Token 等明文只返回一次，Server 只保存 hash。生产跨不可信网络必须使用 HTTPS/WSS，并正确配置外部 Server URL 与 Admin origin。
- 吊销、登出和授权变更应立即收紧权限，但不能删除 DSH 本地会话。

## 验证口径

- 修改协议或跨组件行为时，除单端测试外运行 `make test-e2e`，并覆盖重连、越权、重复请求或事件恢复等相关故障路径。
- Connector 的 Host 仿真 E2E **不等于**真实 DSH 安装、启停、升级、卸载或 Agent 执行验收；未实际执行时不要宣称这些门槛已通过。
- Mobile JS bundle 导出不等于 Xcode/Gradle 原生构建或真机验收；鸿蒙静态检查也不等于 Hvigor HAP 构建、hdc 安装或真机验收。
- 测试未运行、因环境跳过或失败时，在结果中明确说明，不把静态检查描述成完整运行验证。
