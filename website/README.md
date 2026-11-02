# DSH Connect Website

DSH Connect 的公开宣传与产品展示主页。基于 **Next.js 16 App Router + React 19 + TypeScript**，通过静态导出生成完整 HTML，目标访问地址为：

`https://lxy.app/dsh-connect/`

## 技术方案

- `output: 'export'`：构建时生成静态页面，不需要线上 Node.js 运行时。
- `basePath: '/dsh-connect'`：Next.js JS/CSS 和公开资源统一使用该部署前缀。
- 静态内容优先使用 Server Components；菜单、主题和演示交互使用独立 Client Components。
- 所有交互演示只修改浏览器内存，不连接 Go Server、DSH 或真实审批链路。

## 本地开发

要求 Node.js 24。

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5174/dsh-connect/`。

## 检查与构建

```sh
npm run check          # TypeScript + 7 组组件交互测试
npm run build          # 静态导出 + HTML/SEO/资源完整性检查
npm run preview        # 在 4174 端口预览生产产物
```

生产预览地址为 `http://127.0.0.1:4174/dsh-connect/`。`scripts/preview.mjs` 使用 Node.js 内置模块把该前缀映射回 `out/`，同时校验路径边界，不需要额外预览服务依赖。

构建产物位于 `out/`。`scripts/verify-static.mjs` 会检查：

- 首屏、功能、安全与 FAQ 正文确实存在于静态 HTML。
- Canonical、Description、Open Graph、Manifest 和 JSON-LD。
- SoftwareApplication 与 FAQPage 结构化数据可解析。
- 所有带 `/dsh-connect/` 前缀的本地 JS、CSS 和图标文件存在。
- Sitemap、robots、`llms.txt` 和品牌 PNG 的完整性。

## SEO / GEO

- `src/app/layout.tsx`：Metadata、Canonical、Open Graph、Twitter Card、图标和主题色。
- `src/app/page.tsx`：完整静态正文与 `SoftwareApplication` / `FAQPage` JSON-LD。
- `src/app/sitemap.ts`：正式地址 Sitemap。
- `public/robots.txt`：允许抓取并声明 Sitemap。
- `public/llms.txt`：面向 AI 工具的简明产品事实、能力边界和文档入口。

这些配置改善机器可读性，但不承诺任何搜索排名或 AI 引用结果。

## 部署

将 `out/` 中的**全部内容**发布到 `lxy.app` 的 `/dsh-connect/` 子路径。需要保证：

```text
/dsh-connect/                  → index.html
/dsh-connect/_next/...         → 静态 JS/CSS
/dsh-connect/images/icon.png   → 品牌图标
/dsh-connect/sitemap.xml       → Sitemap
/dsh-connect/robots.txt        → robots
/dsh-connect/llms.txt          → AI 工具产品说明
```

单页网站没有客户端路由，不需要 SPA 回退规则，也不需要部署 Next.js Server。若希望 `lxy.app/robots.txt` 指向该 Sitemap，还需在域名根路径单独配置；子路径内的 robots 不会替代域名根 robots。

### Makefile 一键部署

远程主机、目录和密钥路径属于私密部署信息，只在仓库根目录 `.env` 中配置。该文件已被 `.gitignore` 排除，不会随代码提交；配置模板见 `.env.example`。

```dotenv
WEBSITE_REMOTE=deploy-user@example.com
WEBSITE_REMOTE_DIR=/srv/www/example.com/dsh-connect
WEBSITE_BACKUP_DIR=/srv/backups/example.com/dsh-connect
# 可选：留空使用 SSH Agent 或本机默认密钥。
WEBSITE_SSH_KEY=/home/you/.ssh/id_ed25519
```

配置完成后，在仓库根目录执行：

```sh
make website-deploy
```

该指令会依次：

1. 校验 `.env` 中的必填部署配置，缺失时在构建前退出。
2. 执行 `npm --prefix website run build`，构建并验证静态产物。
3. 将 `out/` 内容压缩为 `.tmp/dsh-connect-website-YYYYMMDD-HHMMSS.tar.gz`，排除 macOS 扩展属性、`._*` 和顶层目录元数据，并验证压缩包可读取。
4. 使用 SSH 密钥连接 `WEBSITE_REMOTE`，创建 `WEBSITE_REMOTE_DIR` 和 `WEBSITE_BACKUP_DIR`。
5. 如果远程站点非空，先按远程服务器时间备份为 `WEBSITE_BACKUP_DIR/dsh-connect-YYYYMMDD-HHMMSS.tar.gz`，时间戳精确到秒。
6. 备份成功后，通过 SCP 只传输一个压缩包到远程 `/tmp/`。
7. 在远程解压到站点目录，检查 `index.html`、`_next/` 和 `images/icon.png`，随后清理传输包；本地压缩包在部署成功后删除。

SSH/SCP 均启用 `BatchMode=yes`，不会回退到密码输入；认证失败时直接退出。备份失败或同秒备份文件重名时停止部署，不继续覆盖站点。空站点不生成空备份。部署只覆盖同名文件，不删除远程已有的其他文件。

只有显式执行 `make website-deploy` 才会修改远程站点；本地构建和测试不会自动部署。

## 目录

```text
src/app/                  App Router 页面、全局 Metadata 与 Sitemap
src/components/           页面分区、交互组件、图标与真实内容数据
src/App.test.tsx          组件交互回归测试
src/test/                 Vitest / Testing Library 配置
public/images/icon.png    来自 apps/mobile/assets/images/icon.png 的品牌资源
public/                   robots、Manifest 与 llms.txt
scripts/preview.mjs       子路径生产预览服务器
scripts/verify-static.mjs 静态产物验证
```

## 内容与演示边界

页面文案基于仓库已有产品和架构文档。设备、会话、审批与管理后台指标均为明确标注的模拟数据。正式 CTA 指向真实 GitHub 仓库，不包含虚构下载量、用户评价、价格或未确定的管理后台路由。

如果移动端品牌图标更新，需要同步替换 `public/images/icon.png` 并重新构建。
