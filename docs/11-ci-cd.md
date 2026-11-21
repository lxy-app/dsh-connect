# CI/CD 与发布运维

本文说明 DSH Connect 的 GitHub Actions 质量门禁、制品发布和 Website 部署流程。工作流文件位于 `.github/workflows/`，可复用脚本位于 `scripts/ci/`。

## 1. 总体原则

- PR 和 `main` 推送只运行验证，不发布制品、不连接生产环境。
- Server 与 Connector 使用独立的组件版本标签；手动运行对应工作流只做 dry-run。
- 正式发布由受保护标签触发，并需要 `release` Environment 审批。
- Website 只能手动触发，真实部署需要 `production-website` Environment 审批。
- Server 生产主机滚动更新、移动原生包和真实 DSH 生命周期验收不在当前自动化范围内。

dry-run 可能读写 GitHub Actions 的依赖与构建缓存，但不发布业务制品、不创建 Release，也不连接生产主机。

## 2. CI 质量门禁

`CI` 工作流在以下事件运行：

- 以 `main` 为目标的 Pull Request。
- `main` 分支推送。
- 手动 `workflow_dispatch`；此时运行全部组件检查。

工作流使用 Go 1.26、Node.js 24 和 PostgreSQL 18。Server 测试设置 `DSH_CONNECT_REQUIRE_PG=1`，PostgreSQL 不可用或测试失败不会被当作跳过成功。

| 检查 | 内容 | 默认变更范围 |
|---|---|---|
| Workflow Lint | 使用固定版本 actionlint 检查所有 GitHub Actions 工作流 | 任一 workflow、Dependabot Actions 配置或完整检查 |
| Server | gofmt、`go vet`、PostgreSQL/SQLite 测试 | `server/`、`protocol/` |
| ent 一致性 | 重新生成并检查生成代码无差异 | ent schema、`go.mod`、`go.sum` 或完整检查 |
| Connector | 严格 TypeScript、构建、Node 测试、npm pack dry-run | Connector、`protocol/` |
| Cross-component E2E | 真实 Go Server + Connector + 可控 Host，分别覆盖两种数据库 | Server、Connector、`protocol/` |
| Admin | 类型检查、组件测试、生产构建、Chromium Playwright | Admin、`protocol/` |
| Mobile JS | ESLint、TypeScript、单元测试、iOS/Android JS bundle | Mobile、Mobile Shared、`protocol/` |
| HarmonyOS Static Checks | ESLint、TypeScript、单元测试 | Harmony、Mobile Shared、`protocol/` |
| Website | 类型检查、组件测试、静态导出及资源校验 | `website/` |
| Docker Smoke | Server 镜像构建、SQLite 启动、健康检查、SPA 深路由、未授权 401、非 root 与卷可写；独立 preview-worker 镜像构建、健康检查及真实 LibreOffice DOC→PDF 转换 | Server、Admin、Docker 配置、`protocol/` |

`apps/mobile-shared/` 同时触发主线 Mobile 和 HarmonyOS。`Makefile`、任一 GitHub Actions 工作流、Actions Dependabot 配置或 `scripts/ci/` 变化会运行完整矩阵和 actionlint。文档和原型等无关变更只运行变更检测与最终 Gate。ent 一致性检查同时拒绝已跟踪差异和新生成但未提交的文件。

### Required CI Gate

`CI Gate` 始终运行：未选中的组件允许为 `skipped`，已选中的组件必须为 `success`，变更检测失败或任何已选中任务失败都会使 Gate 失败。

仓库设置中应把 **`CI Gate`** 配置为 `main` 的必需状态检查，而不是分别要求所有可能按路径跳过的组件任务。

## 3. Server + Admin 镜像发布

工作流：`.github/workflows/release-server.yml`。

### dry-run

在 Actions 页面手动运行 **Release Server**，输入形如 `0.1.5` 的版本。工作流会：

1. 确认当前 commit 的 `CI Gate` 已成功。
2. 构建 `linux/amd64` Server 与独立 preview-worker 候选镜像。
3. 使用临时 SQLite 数据运行 Server 容器 Smoke Test，并通过 Worker `/healthz` 与真实 DOC→PDF 转换验证预览镜像。
4. 不登录 Docker Hub、不推送镜像、不创建 GitHub Release。

### 正式发布

1. 确认目标 commit 已合入 `main` 且 CI 成功，并完成真实功能发布门槛。
2. 选择未被使用的版本，创建受保护标签，例如 `server-v0.1.5`。
3. 标签工作流先构建和 Smoke Test，随后在 `release` Environment 等待审批。
4. 审批后的发布 job 会构建、加载并再次 Smoke Test；随后给**同一组已测试本地镜像**添加标签并推送：
   - `lxyapp/dsh-connect:0.1.5` 与 `lxyapp/dsh-connect-preview-worker:0.1.5`
   - 两个仓库各自的 `sha-<完整 commit SHA>`
   - 稳定版本额外更新两个仓库的 `latest`
5. 工作流记录 image ID 和两个镜像推送后的 digest，并创建同名 GitHub Release；预发布 Release 显式标记为 prerelease 且不设为 Latest。

同一组件的发布工作流全局串行，不能并行覆盖默认通道。稳定版本会读取当前 `latest` 镜像的 OCI 版本标签并阻止 SemVer 回退；当前无版本标签的旧镜像需要首次发布审批人工确认基线，本流程生成的新镜像均带版本标签。预发布版本（如 `0.2.0-rc.1`）不会更新 Docker `latest`。版本标签应按不可变制品管理，不要重复使用已发布版本号。

**此流程只发布镜像，不更新任何 Server 生产主机。** 主机部署仍需单独确认目标、数据库备份、迁移兼容性和回退方案。

## 4. Connector npm 发布

工作流：`.github/workflows/release-connector.yml`。

### 版本准备

在独立发布提交中同步 `package.json` 和 lockfile，例如：

```sh
cd connector/dsh-plugin
npm version 0.1.8 --no-git-tag-version
npm test
```

提交并合入后，以 `connector-v0.1.8` 标签触发发布。标签版本必须与 `connector/dsh-plugin/package.json` 完全一致。

### dry-run 与正式发布

手动 **Release Connector** 只运行 CI Gate 检查、版本一致性检查、Connector 测试和 `npm pack --dry-run`，不会读取 npm Token 或发布包。

标签发布会经过 `release` Environment 审批，随后：

- 稳定版本使用 npm dist-tag `latest`；预发布版本使用 dist-tag `rc`。
- 发布前读取当前 dist-tag 并按 SemVer 比较，禁止旧版本或同版本覆盖默认通道；同一组件的发布工作流全局串行。
- 使用 `NPM_TOKEN` 和 npm provenance 发布。
- 发布后查询 registry，确认对应版本可见。

npm 版本不可覆盖。如果发布在 registry 已成功但后续确认步骤失败，不要盲目重发或换版本；先核对 registry 与工作流日志，再人工处理。

## 5. Website 手动部署

工作流：`.github/workflows/deploy-website.yml`。

1. 手动运行 **Deploy Website**，选择已经通过 CI 的 commit。
2. 保持 `dry_run=true` 时只运行 Website 测试、构建和静态产物校验，不连接远程主机。
3. 确认需要上线后，设置 `dry_run=false`。
4. `production-website` Environment 审批通过后，工作流才会获得部署配置并：
   - 再次确认该 commit 的 `CI Gate` 成功。
   - 配置独立 SSH 私钥和预置的 host public key。
   - 通过 `make website-deploy` 构建、备份、上传、解压并检查关键文件。
   - 对首页、用户手册、图标、Sitemap 和实际 `_next` 资源执行 HTTPS Smoke Test。
   - 删除 runner 上的部署私钥。

部署沿用现有行为：远程旧站点先备份，新文件覆盖同名文件，但不删除远程独有的旧文件，也不是原子目录切换。需要回退时使用 `WEBSITE_BACKUP_DIR` 中对应时间的压缩包人工恢复，并重新执行线上 Smoke Test。

## 6. 必需的 GitHub 配置

### 分支与标签保护

- `main` 要求通过 PR 合入，并要求 `CI Gate` 成功。
- 建议要求分支在合入前与 `main` 保持最新。
- 仅允许维护者创建 `server-v*` 和 `connector-v*` 发布标签。

### Environments

- `release`：Docker Hub 和 npm 正式发布，配置维护者人工审批。
- `production-website`：Website 生产部署，配置维护者人工审批。

### Secrets

| Secret | 用途 |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub 用户名 |
| `DOCKERHUB_TOKEN` | 仅具有目标镜像所需权限的访问令牌 |
| `NPM_TOKEN` | 仅具有 `@lxyapp/dsh-connect` 发布所需权限的 npm Token |
| `WEBSITE_REMOTE` | Website 部署用户和主机 |
| `WEBSITE_REMOTE_DIR` | 远程站点目录 |
| `WEBSITE_BACKUP_DIR` | 远程备份目录 |
| `WEBSITE_SSH_PRIVATE_KEY` | 仅用于 Website 部署的 SSH 私钥 |
| `WEBSITE_SSH_HOST_KEY` | `known_hosts` 格式的主机名和 SSH host public key |

真实凭据只写入对应 Environment 的 Secrets，不写入仓库、Issue、PR、日志或 `.env.example`。`WEBSITE_SSH_HOST_KEY` 必须预先可信地核对，不能在部署时通过 `ssh-keyscan` 直接信任未知主机。

## 7. 本地验证

```sh
# Shell 与 workflow 静态检查（actionlint 需单独安装）
bash -n scripts/ci/*.sh
actionlint .github/workflows/*.yml

# 构建并验证 Server + Admin 镜像；只创建临时容器和匿名卷
bash scripts/ci/docker-smoke.sh

# Connector 包内容与发布前构建，不上传 npm
(cd connector/dsh-plugin && npm pack --dry-run)

# Website 测试与静态产物检查，不连接生产主机
npm --prefix website run check
npm --prefix website run build
```

GitHub Actions 固定到完整 commit SHA；`.github/dependabot.yml` 每周分组检查 Actions 更新。更新 Action 时仍需审查变更并运行完整 CI。

## 8. 验证边界

- Mobile JS bundle 不等于 Xcode/Gradle 原生构建或真机验收。
- HarmonyOS 静态检查不等于 HAP 构建、安装或真机验收。
- Connector 的可控 Host E2E 不等于真实 DSH 安装、启停、升级、卸载和 Agent 执行。
- Docker Smoke 使用临时 SQLite，不替代生产 PostgreSQL 备份、迁移和回退演练。
- Website dry-run 不证明 SSH 凭据或线上部署已验收；只有明确关闭 dry-run 并完成审批后才会连接生产主机。
