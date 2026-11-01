# DSH Connect

DSH Connect 面向个人开发者与小团队：用户通过移动端查看和推进桌面 DeepSeek Harness 会话，管理员治理用户、设备、工作区权限、远程审批与审计。

代码库已从产品设计进入 **P0 真实技术验证实现 + 管理后台 MVP + 移动端可用闭环**：已有 Go Server（PostgreSQL 18 + ent）、版本化协议、实际 DSH Connector 与桌面授权面板、对接真实 API 的 Web 管理后台，以及可完成扫码配对、桌面访问授权、工作区浏览、会话查看、提示词发送与远程审批/回答提问的移动 App。移动端已接入会话事件 WSS，用于 assistant 文本的实时流式展示；远程审批同时覆盖 DSH 的 `approval/request` 与 `user-questions/request`，一次性、失败关闭，推送（APNs/FCM）仍属于后续阶段。

## 当前实现状态

| 组件 | 状态 | 说明 |
|---|---|---|
| Protocol v1 | 已实现 | OpenAPI、AsyncAPI、7 个 JSON Schema |
| Go Server | 已实现 P0 | 配对、设备 Hub、REST/WSS、幂等、审计、PostgreSQL 18 + ent |
| 手机配对与访问授权 | 已实现 P1 | 一次性配对码、Token 轮换/吊销；手机按桌面工作区/动作申请，桌面 Connector 显式批准；会话/transcript/prompt/cancel 双重校验 |
| DSH Connector | 已实现 P0 | Host 适配、出站 WSS、工作区授权、桌面面板 |
| 调试客户端 | 已实现 | 配对码、设备、会话、历史、prompt、cancel、follow |
| React Native App | 已实现 P1 读取与推进 | 扫码/手动配对、SecureStore、Token 轮换；工作区、会话列表、transcript 轮询兜底、Markdown 消息渲染、移动事件 WSS 流式回复、排队 prompt、cancel、授权撤销 |
| Web Admin | 已实现 MVP | React 19 + antd 6 + Vite 8，登录/用户/设备/审计，以及桌面与手机配对二维码 |
| 远程审批/提问 | 已实现首版 | 有 `approve` 手机在轮询时由手机优先接管（6 秒 grace），否则直接走桌面原生审批链；移交桌面会先撤回手机副本，不会双卡；超时/离线失败关闭 |
| 附件/推送 | 未开始 | 后续阶段实现；移动实时事件已通过 grant 校验的 WSS 流式推送 |

> 当前 DSH 适配精确锁定 `0.2.1-rc.5`。可控 Host 仿真与跨语言 E2E 不能替代真实 DSH 安装、启停和 Agent 执行验收；实际验证状态见下方“验证”。

## 快速启动

要求 Go 1.25+、Node 20+、Docker（用于 PostgreSQL 18）。

```sh
# 1. 数据库（PostgreSQL 18，数据卷持久化）
make db-up

# 2. 配置：复制模板并填入令牌与 Owner 账号
cp .env.example .env

# 3. 后端：首次启动自动迁移建表并创建 Owner
make run-server

# 4. 管理后台（另开终端）
make admin-install
make run-admin        # http://127.0.0.1:5173
```

默认监听 `127.0.0.1:8787`，数据存在 PostgreSQL（不再是 JSON 文件）。跨不可信网络必须启用 HTTPS/WSS，并显式设置 `DSH_CONNECT_ADMIN_ORIGIN`；不要把令牌或 `.env` 提交到仓库。

详细配置、迁移和管理 API 见 [server/README.md](server/README.md)，管理后台见 [apps/admin/README.md](apps/admin/README.md)，移动工程见 [apps/mobile/README.md](apps/mobile/README.md)，Connector 见 [connector/dsh-plugin/README.md](connector/dsh-plugin/README.md)。

### Docker 一体镜像

`Dockerfile` 将 Go Server 与 Web Admin 构建到同一个镜像，Go Server 同源托管 Admin 静态文件、`/v1` API 和 WebSocket。镜像不包含 PostgreSQL，需连接外部 PostgreSQL 18。

```sh
# 推荐使用 Buildx：x86_64 与 ARM 构建主机均可，ARM 主机会交叉编译。
docker buildx build --platform linux/amd64 \
  -t lxyapp/dsh-connect:latest --load .

docker run -d --name dsh-connect --restart unless-stopped \
  -p 8787:8787 \
  -e DSH_CONNECT_BOOTSTRAP_TOKEN='replace-with-a-long-random-token' \
  -e DSH_CONNECT_DATABASE_URL='postgres://dsh:password@postgres:5432/dsh_connect?sslmode=disable' \
  -e DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL='owner@example.com' \
  -e DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD='replace-with-a-strong-password' \
  -e DSH_CONNECT_SERVER_URL='https://dsh-connect.example.com' \
  lxyapp/dsh-connect:latest
```

容器默认监听 `0.0.0.0:8787`，Admin 与 API 均通过该端口访问。使用 `--env-file .env` 时，若文件内仍是开发默认的 `DSH_CONNECT_LISTEN_ADDR=127.0.0.1:8787`，必须改为 `0.0.0.0:8787`。生产环境应在容器前配置 HTTPS 反向代理，并把 `DSH_CONNECT_SERVER_URL` 设置为手机可访问的公网地址。

也可以用 `docker-compose.server.yml` 部署：它直接读取 `.env`，把监听地址固定覆盖为 `0.0.0.0:8787`，并通过 `host.docker.internal` 支持连接宿主机上的 PostgreSQL 18。宿主端口默认 8787，可用 `DSH_CONNECT_HTTP_PORT` 覆盖。

```sh
docker compose -f docker-compose.server.yml up -d
```

### 调试示例

```sh
export DSH_CONNECT_URL='http://127.0.0.1:8787'
export DSH_CONNECT_TOKEN="$DSH_CONNECT_BOOTSTRAP_TOKEN"

npm --prefix connector/dsh-plugin run debug -- pair-code
npm --prefix connector/dsh-plugin run debug -- devices
npm --prefix connector/dsh-plugin run debug -- list --device dev_xxx
```

## 验证

```sh
make test          # Go Server + Connector 单元/集成测试
make test-e2e      # 真实 Go Server + Connector 协议 + 可控 Host 仿真
make test-admin    # 管理后台类型检查
make test-mobile   # 移动端 ESLint + TypeScript
make check         # go vet、全部测试、跨语言 E2E 与前端/移动端静态检查
```

Server 测试会自动拉起临时 PostgreSQL 18 容器（`internal/pgtest`），每个测试使用独立数据库；没有 Docker 时会跳过，设置 `DSH_CONNECT_REQUIRE_PG=1` 则改为失败。

已覆盖配对码一次性消费、显式桌面授权、设备令牌重连、工作区越权拒绝、会话命令、prompt 并发/持久幂等、持久事件与临时流、慢消费者、离线快速失败和 Store 重载；手机链路覆盖访问申请、桌面批准/拒绝/撤销、工作区过滤、transcript、移动 prompt 幂等和跨手机越权拒绝。

真实 DSH 插件生命周期与真实 Agent 闭环需要按 [实施路线](docs/04-implementation-roadmap.md) 单独验收；在未执行该验收前，不宣称 P0 通过门槛已达成。

## 核心架构

```text
Expo Mobile App（授权/会话/对话） ── HTTPS ──> Go Server <── 持久出站 WSS ── DSH Connect Connector
Web Admin（已实现）    ── HTTPS ──────>      │                                  │
                                            │                                  └─ DeepSeek Harness Desktop
                                            │                                     Session Log / Host API
                                            ├─ PostgreSQL 18（ent）
                                            └─ APNs / FCM（后续）
```

- **DSH Session Log** 是会话唯一事实源；Server 不读取 DSH 内部文件。
- **Connector** 隔离 DSH 版本相关类型，执行工作区/动作白名单。
- **Server** 负责配对、设备认证、手机访问授权、命令路由、幂等、事件中继和审计，状态存于 PostgreSQL。
- 桌面只建立主动出站连接，不需要公网入站端口。
- 手机配对与桌面配对相互独立，仅配对手机不会获得桌面权限；访问范围由桌面 Connector 对每个手机显式批准，Server 只校验和执行 grant。

## 代码库结构

```text
dsh-connect/
├── apps/admin/                   # Web 管理后台（React 19 + antd + Vite）
├── apps/mobile/                  # Expo SDK 58 移动 App（配对、授权、工作区、会话）
├── connector/dsh-plugin/         # 真正的 DSH Connector + 桌面面板 + 调试客户端
├── protocol/                     # OpenAPI / AsyncAPI / JSON Schema
├── server/
│   ├── cmd/server/               # Go Server 入口
│   ├── ent/                      # ent schema 与生成的实体代码
│   └── internal/                 # API、Hub、路由、协议、Store 与 pgtest
├── docs/                         # 产品、架构、原型与实施路线
├── dsh-connect-prototype.html    # 独立高保真交互原型
└── prototype/                    # 旧实验性预览源码，不是实际 Connector
```

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-system-architecture.md](docs/01-system-architecture.md) | 总体架构、协议、配对、恢复、审批与安全设计 |
| [02-product-design.md](docs/02-product-design.md) | 产品角色、App、Admin、Connector 与状态设计 |
| [03-prototype-guide.md](docs/03-prototype-guide.md) | 独立 HTML 的页面与演示边界 |
| [04-implementation-roadmap.md](docs/04-implementation-roadmap.md) | 阶段、验收标准、测试重点与风险 |
| [05-p0-verification.md](docs/05-p0-verification.md) | P0 已实现范围、自动化结果与真实 DSH 验收清单 |
| [server/README.md](server/README.md) | Server 配置、PostgreSQL/ent 迁移与管理 API |
| [apps/admin/README.md](apps/admin/README.md) | 管理后台开发、页面与权限模型 |
| [apps/mobile/README.md](apps/mobile/README.md) | Expo 工程、Development Build、模块与安全边界 |
| [connector/dsh-plugin/README.md](connector/dsh-plugin/README.md) | 实际 Connector、桌面 RPC、调试与限制 |
| [protocol/README.md](protocol/README.md) | v1 契约与恢复语义 |

## 查看交互原型

直接用浏览器打开 [dsh-connect-prototype.html](dsh-connect-prototype.html)。它不需要 Server，不连接真实 DSH，所有设备、会话和审批均为模拟数据。

`prototype/` 是早期 Cordis 预览实验，不参与实际 Connector 运行，不应作为产品插件安装。

## 许可证

本项目以 [Apache License 2.0](LICENSE) 授权发布，Copyright 2026 li-xing-yun。

你可以在遵守许可证条款的前提下自由使用、修改与再分发本项目（含商业用途）；再分发时需保留原始版权与许可声明，并附带许可证副本。第三方依赖仍遵循其各自许可证。
