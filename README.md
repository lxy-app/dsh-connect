# DSH Connect

DSH Connect 让你在手机上继续桌面的 DeepSeek Harness（DSH）会话。离开电脑后，可以查看 Agent 的进度、发送下一条指令，或在需要确认时处理审批和提问。Agent 在桌面执行，Connector 主动连接自托管的 Server，桌面无需开放入站端口。

管理员在 Web 后台配对设备、管理访问策略和查看审计。桌面用户决定每部手机可以访问哪些工作区，以及能否读取、发送指令、停止执行或处理审批。

## 使用指南

| 你要做什么 | 从这里开始 |
|---|---|
| 团队已有服务，要从手机打开桌面上的会话 | [首次连接与日常使用](#首次连接与日常使用) |
| 准备一台主机，供桌面和手机连接 | [使用 Docker Compose 部署](#使用-docker-compose-部署) |
| 从源码把 App 装到自己的设备 | [编译并安装手机端](#编译并安装手机端) |
| 了解各平台能做什么 | [当前功能与平台支持](#当前功能与平台支持) |
| 在本地开发或运行测试 | [本地开发](#本地开发) · [验证](#验证) |

完整步骤及按症状排障见[官网用户手册](https://lxy.app/dsh-connect/docs/)。

### 首次连接与日常使用

1. **管理员生成桌面配对码。** 在后台进入“设备管理” → “桌面 Connector” → “添加桌面”。 桌面用户在 DSH `0.2.2-rc.1` 的 Plugin Manager 中将 `@lxyapp/dsh-connect@0.1.5` 填入“包名或地址”，确认安装并启用。[npm 包主页](https://www.npmjs.com/package/@lxyapp/dsh-connect)。自行打包时，从仓库根目录进入 `connector/dsh-plugin`，依次运行 `npm ci`、`npm run build`、`npm pack`，选用输出的 `.tgz`。在 Plugins 页确认 active。[桌面安装说明](connector/dsh-plugin/README.md)
2. **桌面用户开放工作区。** 在 DSH Connect 面板填写 Server 地址和桌面配对码，点“保存并配对”，在桌面核对设备指纹，选择已有会话的工作区和允许的动作，点“确认授权并上线”。管理后台应能看到该桌面在线。
3. **管理员为手机生成另一个码。** 在后台“设备管理” → “手机设备”选择所属用户，生成一次性二维码。手机打开 App → “连接 Server” → “扫描配对二维码”，或手动填写同页显示的地址和手机配对码。
4. **手机申请，桌面确认。** 在手机“设备”找到目标桌面，点“申请访问”，选工作区及所需动作，点“提交访问申请”。桌面用户在“手机访问授权”核对并批准后，手机下拉刷新。
5. **打开第一个会话。** 在“会话”的工作区抽屉中打开已有会话，确认历史可读。如果桌面在线且手机同时获得读取与发送权限，也可以点工作区旁的“＋”新建会话。获准发送后，输入“请简要总结当前进度”，等待本轮回复结束。发送后网络中断时，先重连查看历史再决定下一步。
6. **处理后续操作。** 停止执行需要取消权限；处理审批和提问需要远程审批权限。核对请求后再决定或作答，过期或撤回时查看会话最新状态。要收回某部手机的访问，在桌面面板撤销授权；手机遗失时由管理员在后台吊销设备。

### 使用 Docker Compose 部署

按镜像来源选择一种方式。两种方式都使用同一个 Compose 文件、配置项和持久卷。

#### 方式一 · 从 Docker Hub 拉取镜像部署

在安装了 Docker、Compose 和 curl 的主机上新建目录，下载部署文件：

```sh
mkdir dsh-connect-deploy
cd dsh-connect-deploy
curl -fLO https://raw.githubusercontent.com/lxy-app/dsh-connect/main/docker-compose.server.yml
curl -fL https://raw.githubusercontent.com/lxy-app/dsh-connect/main/.env.example -o .env
```

填写下方[公共配置](#部署公共配置)，然后拉取并启动发布镜像 `lxyapp/dsh-connect:latest`。[Docker Hub 镜像仓库](https://hub.docker.com/r/lxyapp/dsh-connect)

```sh
docker compose -f docker-compose.server.yml pull server
docker compose -f docker-compose.server.yml up -d --pull never
```

#### 方式二 · 从源码构建镜像部署

在部署主机准备 Git、Docker、Buildx 和 Compose。从要部署的源码版本构建；首次获取仓库可执行：

```sh
git clone https://github.com/lxy-app/dsh-connect.git
cd dsh-connect
cp .env.example .env
```

已有仓库和配置时直接在仓库根目录操作。填写下方[公共配置](#部署公共配置)，然后构建与 Compose 文件同名的本地镜像并启动：

```sh
docker buildx build --load -t lxyapp/dsh-connect:latest .
docker compose -f docker-compose.server.yml up -d --pull never
```

#### 部署公共配置

编辑 `.env`，至少完成以下设置：

| 配置项 | 填写内容 |
|---|---|
| `DSH_CONNECT_BOOTSTRAP_TOKEN` | 使用 `openssl rand -hex 32` 生成随机值，仅管理员保管 |
| `DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL`、`DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD` | 首次登录邮箱和强密码（至少 8 位）。仅空用户表首次启动时创建 Owner |
| `DSH_CONNECT_DATABASE_URL` | 默认连接预先准备的 PostgreSQL 18，例如 `postgres://USER:PASSWORD@DB_HOST:5432/dsh_connect?sslmode=verify-full`，替换占位符并配置相应证书。容器访问宿主机数据库可使用 `host.docker.internal`，数据库须允许该连接。单实例可直接填写 `sqlite:///data/sqlite/dsh-connect.db` |
| `DSH_CONNECT_SERVER_URL` | 填写桌面和手机都能访问的外部地址，如 `https://connect.example.com`；它将出现在配对信息中 |
| `DSH_CONNECT_ATTACHMENTS` | 需要手机上传图片或文件时填写 `readwrite`。缺省为 `read`。修改后用 Compose 重建 server 容器，在管理后台「设置」确认附件模式 |
| `DSH_CONNECT_ADMIN_ORIGIN` | Admin 独立域名部署时填写其完整 origin，如 `https://admin.example.com`；同源部署可留空 |

#### 部署验证

完成所选方式的启动步骤后，在对应部署目录检查容器状态和日志：

```sh
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs --tail=50 server
```

Compose 默认发布宿主机 8787 端口，可用 `DSH_CONNECT_HTTP_PORT` 修改。对外使用 HTTPS 反向代理，并支持 WebSocket 的 Upgrade 转发；将后端端口限制在代理可达范围。Compose 持久化附件目录 `/data/attachments` 和 SQLite 目录 `/data/sqlite`。重建容器时保留命名卷；SQLite 使用单副本与本机卷，PostgreSQL 数据由数据库所在主机持久化。

**部署验收**：浏览器访问外部地址，用 Owner 邮箱和密码登录；手机浏览器也应能打开同一地址。按上节配对桌面，确认后台显示在线，然后在手机查看已授权会话。若手机二维码中的地址仍为 `127.0.0.1`，修正外部地址，再次运行上面的 `up -d` 并生成新码。

**附件上传排障。** 使用 Nginx 且遇到 HTTP 413 时，检查反向代理请求体上限。Server 默认允许单文件 20 MiB，可在 Nginx 对应的 `server` 块设置 `client_max_body_size 25m;` 后重载。若将附件命名卷改为宿主机目录，确保容器用户（UID/GID 10001）对该目录有写权限。

### 编译并安装手机端

三组命令均从仓库根目录开始，使用 Node.js 24。iOS/Android 开发包会加载 Metro 提供的代码，构建机与手机需网络互通。

**iPhone** · 准备 macOS、Xcode、CocoaPods 和可用开发签名。连接并解锁 iPhone，信任电脑并开启开发者模式。在 Xcode 配置开发团队，然后运行：

```sh
cd apps/mobile
npm ci
npm run ios -- --device
```

选择目标 iPhone；命令编译、安装 Development Build 并启动 Metro。

**Android** · 准备 Android Studio、Android SDK 与 adb。手机开启 USB 调试并允许这台电脑调试，然后运行：

```sh
cd apps/mobile
npm ci
adb devices
npm run android -- --device
```

确认设备状态为 `device` 并选择目标手机。命令用调试签名安装开发包并启动 Metro。iOS/Android 后续开发可在同一目录运行 `npm start`；原生模块或权限配置变更后需重新编译。云构建与分发配置见[移动端 README](apps/mobile/README.md)。

**HarmonyOS** · 准备 DevEco Studio 6.1+、HarmonyOS SDK、OHPM、Hvigor 和 hdc。真机开启开发者模式，用 DevEco 为目标设备生成调试签名，按[鸿蒙签名示例](apps/mobile-harmony/README.md#签名与-hap-构建)准备仓库外的 JSON5 文件，再替换下面的路径：

```sh
cd apps/mobile-harmony
npm ci --legacy-peer-deps
npm run doctor
export EXPO_HARMONY_SIGNING_CONFIG_FILE=/absolute/path/to/signing.json5
npm run setup:native
npm run build:hap
hdc list targets
hdc install -r harmony/entry/build/default/outputs/default/entry-default-signed.hap
npm start
```

打开已安装的 App，看到“连接 Server”后使用管理员生成的手机配对码。开发包连接 Metro 与 App 配对业务 Server 是两个步骤，各自使用对应服务的地址。

## 当前功能与平台支持

| 使用场景 | 当前支持 |
|---|---|
| 查看进度 | 按工作区浏览会话，查看历史、工具步骤摘要和 Markdown 回复。运行中的回复通过 WebSocket 实时显示，连接中断时回退到轮询。 |
| 推进会话 | 在授权工作区新建会话、发送或排队指令。有发送权限时，可在当前会话切换模型与推理强度。有取消权限时，可停止当前轮次。 |
| 审批与提问 | 有审批权限的手机在前台检查待处理项时，优先收到一次性请求。默认 6 秒内未作答，Connector 先撤回手机卡片，再转交桌面。系统通知（APNs/FCM）尚未接入。 |
| 收发附件 | 手机可全屏查看桌面交付的图片。iOS/Android 可拍照、选图或选文件，上传后单独发送或附在指令中。上传需要 Server 开启 `DSH_CONNECT_ATTACHMENTS=readwrite` 且手机具有该工作区的发送权限。非图片交付文件目前仅展示信息。 |
| 语音交互 | iOS/Android 支持按住说话转写、确认后发送，以及朗读回复。可使用系统语音，也可配置火山 Agent Plan 的 ASR/TTS。 |
| 后台管理 | 管理用户、设备和访问策略，查看运行中的会话元数据、待处理审批与提问、服务配置和审计记录。管理员可配置远程审批开关和有效期。 |

**平台与验收范围**

- **iOS / Android** 使用 Expo SDK 58 Development Build。附件上传已有单元测试与可控 Host 跨端测试记录，拍照、选择附件和上传仍待真机验收。[移动端说明](apps/mobile/README.md) · [附件验证记录](docs/06-mobile-attachments-design.md)
- **HarmonyOS** 使用 Expo SDK 55 + RNOH 0.84.1，与主线共享业务源码。已在 HUAWEI Mate 80 Pro（HarmonyOS 7 / API 26）验证签名 HAP 安装、配对与远程会话。当前不支持在手机上选择附件，扫码、语音和远程审批仍需逐项真机验收。[鸿蒙端说明](apps/mobile-harmony/README.md)
- **桌面** 的 Host API 适配锁定 DSH `0.2.2-rc.1`。插件生命周期及真实 Agent 执行需按对应版本单独验收。[Connector 说明](connector/dsh-plugin/README.md)

## 本地开发

要求 Go 1.26+、Node 24+；默认 PostgreSQL 18 路径需要 Docker，SQLite 路径不需要独立数据库服务。

```sh
# 1. 默认数据库（PostgreSQL 18，数据卷持久化）
#    使用 SQLite 时跳过此步
make db-up

# 2. 配置：复制模板并填入令牌与 Owner 账号
cp .env.example .env

# 3. 后端：首次启动自动迁移建表并创建 Owner
make run-server

# 4. 管理后台（另开终端）
make admin-install
make run-admin        # http://127.0.0.1:5173
```

默认监听 `127.0.0.1:8787`，配对、授权与审计数据保存在所选数据库。单实例 SQLite 可在 `.env` 中改为 `DSH_CONNECT_DATABASE_URL=sqlite://./data/dsh-connect.db`（父目录需已存在），无需执行 `make db-up`。跨不可信网络必须启用 HTTPS/WSS，并显式设置 `DSH_CONNECT_ADMIN_ORIGIN`；不要把令牌或 `.env` 提交到仓库。

详细配置、迁移和管理 API 见 [server/README.md](server/README.md)，管理后台见 [apps/admin/README.md](apps/admin/README.md)，移动工程见 [apps/mobile/README.md](apps/mobile/README.md)，Connector 见 [connector/dsh-plugin/README.md](connector/dsh-plugin/README.md)。

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
make test          # Go Server 双数据库测试 + Connector 单元/集成测试
make test-e2e      # PostgreSQL / SQLite + 真实 Go Server + Connector + 可控 Host 仿真
make test-admin    # 管理后台类型检查与组件测试
make test-admin-e2e # 管理后台浏览器测试，需先安装 Chromium
make test-mobile   # 主线移动端 ESLint、TypeScript 与单元测试
make test-mobile-harmony # 鸿蒙壳 ESLint、TypeScript 与单元测试
make check         # go vet、Server/Connector 测试与 E2E、Admin 和两套移动端检查与单测
```

Server 测试由 `internal/dbtest` 选择数据库，同一套用例分别运行 PostgreSQL 与 SQLite。PostgreSQL 会自动拉起临时 18 容器（`internal/pgtest`），每个测试使用独立数据库；没有 Docker 时会跳过，设置 `DSH_CONNECT_REQUIRE_PG=1` 则改为失败。SQLite 每个测试使用独立临时文件，无需 Docker。`make test-e2e` 同样运行两种数据库；PostgreSQL E2E 应通过 `DSH_CONNECT_E2E_DATABASE_URL` 使用独立业务数据库，SQLite E2E 自动使用临时文件。

已覆盖配对码一次性消费、显式桌面授权、设备令牌重连、工作区越权拒绝、会话命令、prompt 并发/持久幂等、持久事件与临时流、慢消费者、离线快速失败和 Store 重载；手机链路覆盖访问申请、桌面批准/拒绝/撤销、工作区过滤、transcript、移动 prompt 幂等和跨手机越权拒绝。

真实 DSH 插件生命周期与真实 Agent 闭环需要按 [实施路线](docs/04-implementation-roadmap.md) 单独验收；在未执行该验收前，不宣称 P0 通过门槛已达成。

## 核心架构

```text
手机 App ─── HTTPS / WSS ──┐
                          ├── Go Server ─── PostgreSQL 18 或单实例 SQLite
Web Admin ─── HTTPS ──────┘       ↑      └── 附件存储
                                 │ 出站 WSS
                        桌面 Connector ─── DSH Host API / Session Log
```

- **DSH Session Log** 是会话唯一事实源；Server 不读取 DSH 内部文件。
- **Connector** 隔离 DSH 版本相关类型，执行工作区/动作白名单。
- **Server** 负责配对、设备认证、手机访问授权、命令路由、幂等、事件中继和审计，状态存于所选的 PostgreSQL 或 SQLite。
- 桌面只建立主动出站连接，不需要公网入站端口。
- 手机配对与桌面配对相互独立，仅配对手机不会获得桌面权限；访问范围由桌面 Connector 对每个手机显式批准，Server 只校验和执行 grant。

## 代码库结构

```text
dsh-connect/
├── apps/admin/                   # Web 管理后台（React 19 + antd + Vite）
├── apps/mobile/                  # Expo SDK 58 iOS/Android App（配对、授权、工作区、会话）
├── apps/mobile-harmony/          # Expo SDK 55 + RNOH 0.84.1 鸿蒙壳
├── apps/mobile-shared/           # 双端共享 TS/TSX 源码（@shared/*）
├── connector/dsh-plugin/         # 真正的 DSH Connector + 桌面面板 + 调试客户端
├── protocol/                     # OpenAPI / AsyncAPI / JSON Schema
├── server/
│   ├── cmd/server/               # Go Server 入口
│   ├── ent/                      # ent schema 与生成的实体代码
│   └── internal/                 # API、Hub、路由、协议、Store 与 dbtest/pgtest
├── website/                      # 项目官网与用户手册
├── docs/                         # 产品、架构、原型与实施路线
└── prototype/                    # 独立 HTML 交互原型（产品 + 官网）
```

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-system-architecture.md](docs/01-system-architecture.md) | 总体架构、协议、配对、恢复、审批与安全设计 |
| [02-product-design.md](docs/02-product-design.md) | 产品角色、App、Admin、Connector 与状态设计 |
| [03-prototype-guide.md](docs/03-prototype-guide.md) | 独立 HTML 的页面与演示边界 |
| [04-implementation-roadmap.md](docs/04-implementation-roadmap.md) | 阶段、验收标准、测试重点与风险 |
| [05-p0-verification.md](docs/05-p0-verification.md) | P0 已实现范围、自动化结果与真实 DSH 验收清单 |
| [06-mobile-attachments-design.md](docs/06-mobile-attachments-design.md) | 移动端文件与图片展示：来源、契约、字节通道、安全与分阶段实施 |
| [server/README.md](server/README.md) | Server 配置、PostgreSQL/SQLite + ent 迁移与管理 API |
| [apps/admin/README.md](apps/admin/README.md) | 管理后台开发、页面与权限模型 |
| [apps/mobile/README.md](apps/mobile/README.md) | iOS/Android Expo 工程、Development Build、模块与安全边界 |
| [apps/mobile-harmony/README.md](apps/mobile-harmony/README.md) | 鸿蒙 SDK 55 + RNOH 壳、HAP 构建、签名与真机验证 |
| [connector/dsh-plugin/README.md](connector/dsh-plugin/README.md) | 实际 Connector、桌面 RPC、调试与限制 |
| [protocol/README.md](protocol/README.md) | v1 契约与恢复语义 |

## 查看交互原型

直接用浏览器打开 [prototype/dsh-connect-prototype.html](prototype/dsh-connect-prototype.html)（产品交互原型），或 [prototype/dsh-connect-website-prototype.html](prototype/dsh-connect-website-prototype.html)（官网主页原型）。两者都不需要 Server、不连接真实 DSH、不依赖构建，页面内的设备、会话和审批均为模拟数据。

## 许可证

本项目以 [Apache License 2.0](LICENSE) 授权发布，Copyright 2026 li-xing-yun。

你可以在遵守许可证条款的前提下自由使用、修改与再分发本项目（含商业用途）；再分发时需保留原始版权与许可声明，并附带许可证副本。第三方依赖仍遵循其各自许可证。
