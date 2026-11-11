# DSH Connect 银白品牌主题实施记录

## 1. 目标与边界

将已确认的银白原型方向落地到真实产品，保持现有业务逻辑、协议、路由和权限语义不变。

- 浅色品牌强调：石墨 `#4B5563`，浅银底 `#E8EDF2`。
- 深色品牌强调：图标白 `#F4F6F8`，深色银底 `#353B43`，前景文字 `#171A1F`。
- 应用图标：暖白底 `#F4F6F8`，炭黑鲲标 `#232529`。
- 成功、警告、危险等语义色独立保留。
- 不手工修改 CNG 生成的 `ios/`、`android/`、`harmony/` 目录。

## 2. 任务拆分

| 子任务 | 范围 | 当前状态 |
|---|---|---|
| P0 品牌资源 | 应用图标、Android 自适应层、iOS Icon Composer、favicon | 已完成 |
| P1 Mobile 主题 | 主线 Mobile、鸿蒙壳明暗令牌、启动图、通知色、对比度测试 | 已完成 |
| P2 Admin / Connector | 真实管理后台与桌面面板品牌样式 | 已完成 |
| P3 Website | 正式站点品牌样式与响应式视觉回归 | 已完成 |
| P4 整体验收 | 各工程静态检查、测试、构建、可行视觉检查与交付说明 | 已完成 |

## 3. Mobile 实施结果

- `apps/mobile/src/constants/theme.ts` 与 `apps/mobile-harmony/src/constants/theme.ts` 使用同一套中性色令牌，现有组件继续通过 `useAppTheme()` 消费，无需逐页硬编码改色。
- 新增明暗主题 accent/onAccent 与 accent/accentSoft 对比度回归测试。
- 浅色启动页使用暖白底与炭黑鲲标，深色启动页使用深色底与暖白鲲标；两种启动图共用相同 Alpha 轮廓。
- Android 通知色改为石墨 `#4B5563`；Android monochrome 仍保留平台要求的纯黑掩膜。
- 主线 Mobile：ESLint、TypeScript、92 项单元测试及 iOS/Android JS bundle 导出通过。
- 鸿蒙壳：ESLint、TypeScript、100 项单元测试通过。

## 4. 验证口径

- JS bundle、Expo 配置解析和静态检查不等同于原生构建或真机视觉验收。
- 应用图标、启动页和系统通知色需在重新 prebuild、原生构建并安装后验收。
- 鸿蒙侧需重新执行 `setup:native` 与 HAP 构建，再进行真机检查。
- Admin 与 Connector 的实施和验证结果见下节。

## 5. Website 实施与验证

- `website/src/styles.css` 将 `--violet` 令牌改为 `--accent`，同步首屏光晕、按钮、手机演示、Admin 图表、工作流、安全区和收尾卡片；`Features.tsx` 的代码高亮类同步改名。
- `layout.tsx` 与 `manifest.webmanifest` 的浏览器主题色统一为 `#0B0E12`；正式站点继续使用更新后的暖白底炭黑鲲标 PNG。
- TypeScript、7/7 单元测试、Next.js 静态导出及 24/24 静态完整性检查通过。
- 使用临时本地服务与隔离无头 Chrome 验证真实 `website/out` 构建产物：11 项浏览器断言通过，覆盖首屏按钮、明暗主题、审批按钮对比、移动导航、品牌图加载及桌面/390px/320px 横向边界；无 JavaScript 运行异常。
- 已目检正式站点首屏与功能区截图；未部署线上地址。

## 6. Admin / Connector 实施与验证

### Admin

- `ThemeProvider.tsx` 统一品牌主色、按钮前景、Layout/Menu/Tag 令牌；角色、平台和中性标签不再使用品牌蓝紫，owner、processing、success/warning/error 等语义色保持独立。
- `Sider` 与 `Menu` 显式共享明暗主题，`darkItemSelectedBg` 固定为 `#F4F6F8`；深色非危险主按钮通过局部 `--ant-btn-*` 变量保持精确色值，避免 Ant Design 暗色算法将近白色派生为灰色。
- Admin 图标与 Mobile 当前暖白底炭黑鲲标 PNG 保持字节一致。
- TypeScript、9 个测试文件 19 项测试及 Vite 生产构建通过。
- 使用真实 `dist` 与模拟只读 API 完成 13 项视觉断言及补充异常检查：覆盖浅色/深色菜单、登录主按钮、1024px 图标、桌面/390px/320px 横向边界；已目检浅色与深色截图，无 JavaScript 运行异常。模拟 API 仅用于视觉验收，不代表真实 Server 端到端结果。

### Connector

- 面板品牌 logo、焦点、主按钮和复选框改用本地 `--dsc-brand` / `--dsc-brand-soft` / `--dsc-on-brand`，不再引用宿主的 `--dsw-alias-brand-primary`；根据宿主实际背景亮度选择明暗配色。
- `icon.svg` 改为中性石墨渐变，绿色状态点保留；新增 bundle 测试守住品牌令牌、对比前景和宿主品牌变量隔离。
- TypeScript、112/112 测试及最终构建通过。
- 未进行真实 DSH Host 面板视觉验收，也未验证插件安装、启停等生命周期；本次没有协议或业务逻辑变更，未运行协议故障路径 E2E。

## 7. 交付边界与后续验收

- 改动位于独立 PR 分支 `feat/silver-white-ui`；线上部署状态以实际发布记录为准。
- 未修改 Server、线上协议、权限模型或业务逻辑。
- 已核对 Mobile、鸿蒙壳、Admin、Website 的应用图标一致性，以及双壳主题和图标生成脚本一致性；旧紫色品牌值无生产源码残留，测试中的否定断言除外。
- 仍需按目标平台重新 prebuild/原生构建并安装，验收真实应用图标、启动页、系统通知色与 Mobile 页面；鸿蒙需重新执行 `setup:native` 和 HAP 构建。
- 如需发布 Website，应基于本次最终源码重新构建并走既有部署流程，不能把本地视觉验收描述为线上已生效。

## 8. 深色会话页 WorkBuddy 对齐（2026-11-11）

- 深色令牌改为中性近黑：background `#1A1A1A`、surface `#242424`、surfaceMuted `#303030`、border `#333333`、textSecondary `#9C9C9C`；图标白 accent 与语义状态色保持不变。
- 用户气泡独立使用 `bubbleUser` / `onBubbleUser`：深色为 `#383838` / `#F2F2F2`，浅色沿用品牌炭黑 `#232529` / 白色，避免把 accent 复用于气泡。
- 时间不再放在气泡或 Turn 卡片内：`shouldShowTimeDivider` 在首条消息或与上一 Turn 末条相隔 5 分钟时，于消息组上方居中显示 `HH:mm`；跨天仍只显示时间。
- 助理 Turn 去掉卡片边框与底色，`已完成` / `深度求索中` 与折叠箭头改为灰字；用时移入展开后的执行步骤，朗读按钮移到标题行右侧。
- 预览：`prototype/previews/mobile-workbuddy-chat.html` 与 `mobile-workbuddy-chat.png`（390×844 离线渲染，非真机截图）。
- 双端 ESLint、TypeScript、Mobile 97/97 单元测试与 iOS/Android bundle 导出通过；未进行 iOS/Android/鸿蒙真机视觉验收。
