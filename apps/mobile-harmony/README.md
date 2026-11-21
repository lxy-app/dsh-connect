# DSH Connect HarmonyOS

DSH Connect 的鸿蒙运行时壳。与 `apps/mobile/` 的 iOS/Android 主线并列：**共享业务源码，但不共享 Expo 依赖版本或原生构建产物**。

当前基线为 Expo SDK 55.0.31 + RNOH 0.84.1，已在 HUAWEI Mate 80 Pro（HarmonyOS 7 / API 26）上完成签名 HAP 构建、安装、用户登录和真实远程 DSH 会话验证。

新建会话与主线共用“创建 → 附件上传 → 首条 prompt”编排和语音转写 Hook。火山 ASR 依赖实时音频原生模块；附件选择器仍按现有能力明确提示不支持，不以静态检查代替 HAP 与真机验收。

会话过程与主线共用有序分组：整轮标题只显示状态和用时，不提供整轮折叠；相邻工具步骤形成可独立折叠的过程组，可见中间回复与最终回复始终留在折叠区外。组身份使用首个成员的事件 seq，手动开合状态优先于运行态默认值。

## 环境要求

- Node.js 24（npm / Metro / prebuild）。
- DevEco Studio 6.1+，含 HarmonyOS SDK、OHPM、Hvigor、hdc。
- 真机开启开发者模式；安装前需要本机签名材料。
- 不需要 Android SDK 或 adb。

## 安装与检查

```bash
npm ci --legacy-peer-deps
npm run check       # ESLint + TypeScript
npm run doctor      # DevEco / SDK / Metro / RNOH 诊断
```

本工程独立维护 `package-lock.json`。不要因为 `apps/mobile/` 升级而修改本目录版本；先看上游支持矩阵。

## 品牌主题

`src/constants/theme.ts` 与主线 Mobile 使用同一套银白品牌令牌：浅色 accent 与 textSecondary 统一为品牌炭黑 `#232529`，分别覆盖灰色按钮、次级文字与未选中图标，主文字保持 `#181B20`；深色图标白 `#F4F6F8`，语义状态色独立保留。深色会话页与主线对齐 WorkBuddy：背景 `#1A1A1A`、用户气泡 `#383838`、时间居中显示在消息组上方。应用图标与启动资源由 `assets/logo-candidates/build-icon-assets.py` 生成；原生图标变化需重新执行 `setup:native` 和 HAP 构建，静态检查不代表真机视觉验收。

## 启动 Metro

```bash
npm start
```

公开的开发 Server 地址可在启动命令中指定：

```bash
EXPO_PUBLIC_DSH_CONNECT_SERVER_URL=https://dsh.lxy.app npm start
```

`EXPO_PUBLIC_*` 会进入 JS 包，只能放公开地址，不能放 token 或密钥。当前 DevEco 内置 Node 18 与 `@expo/env` 的 `util.parseEnv` 不兼容；原生构建不要依赖本目录 `.env`，请在命令环境中传入公开变量。

## 生成原生工程

```bash
npm run setup:native
```

该命令依次执行：上游 HAR 补丁 → Expo CNG prebuild → OHPM 安装 → 解压副本修正。`harmony/` 是生成物并已忽略，不要手改作为永久方案。`patch-upstream.sh` 也会调用 `patch-safe-area.sh`，让 safe-area-context 5.6.4 从主窗口同步读取 inset，避免冷启动竞态返回全零；`patch-pdf-autolinking.sh` 仅在旧包缺少 ArkTS Package 时移除无效注册；检测到有效 `PdfViewPackage` 与 `RTNPdfView` builder 时必须保留自动链接，避免原生视图白屏。

## 签名与 HAP 构建

如需真机安装，先生成 DevEco 调试签名材料，并把签名配置保存到本目录之外的本地 JSON5 文件：

```json5
{
  name: 'default',
  type: 'HarmonyOS',
  material: {
    certpath: '/absolute/path/to/debug.cer',
    storeFile: '/absolute/path/to/debug.p12',
    profile: '/absolute/path/to/debug.p7b',
    storePassword: '...',
    keyAlias: 'debugKey',
    keyPassword: '...',
    signAlg: 'SHA256withECDSA',
  },
}
```

然后执行：

```bash
export EXPO_HARMONY_SIGNING_CONFIG_FILE=/absolute/path/to/signing.json
npm run setup:native
npm run build:hap
```

产物位于：

```text
harmony/entry/build/default/outputs/default/entry-default-signed.hap
```

未设置签名文件时可以构建 unsigned HAP，但不能宣称真机安装通过。签名文件、口令、证书和私钥均不得提交。

构建 Release 时执行：

```bash
npm run build:hap -- release
```

Debug / Release 使用不同的 autolinking 快照；构建脚本检测变体切换时会自动重新执行 `setup:native`，也可单独运行 `npm run setup:native -- release`。

安装到已连接设备：

```bash
hdc install -r harmony/entry/build/default/outputs/default/entry-default-signed.hap
```

## 代码结构

```text
apps/mobile-harmony/
├── src/app/           # 鸿蒙 Expo Router 壳；当前根导航使用 Slot
├── src/platform/      # 平台实现与适配边界
├── src/shims/         # 鸿蒙 API 兼容与明确降级
├── modules/harmony-audio-stream/ # ArkTS AudioCapturer 实时 PCM 原生模块
├── scripts/           # 可重复的补丁、prebuild 和 HAP 构建脚本
├── vendor/            # 固定版本的上游 JS 与鸿蒙 HAR 提供包
├── app.json           # bundleName、权限、SDK 与 Expo 模块配置
├── app.config.js      # 从本地环境变量注入签名文件，不写入口令
└── metro.config.js    # RNOH resolver、双 React 与 @shared/* 映射
```

通用业务代码放在 `apps/mobile-shared/`。平台差异不要写进共享目录；主线也不要为了鸿蒙修改 SDK 版本。

## 附件文档预览

- 文件卡点击后才下载；MD/TXT/JSON/LOG 在应用内阅读，PDF 与 Office 转换结果使用本地 `react-native-pdf`。Office 预览依赖 Server 的可选 preview-worker，不需要桌面安装办公套件。缓存重开必须经 Bearer + `If-None-Match` 鉴权并收到 304，401/403 或断网不会直接展示旧缓存。
- PDF 原生依赖锁定为 `@react-native-ohos/react-native-pdf@7.1.0`（上游 `react-native-pdf@7.0.4`）与对应 BlobUtil；该版本提供面向 RNOH 0.84 的 ArkTS `PdfViewPackage`。Expo/RNOH 版本保持 SDK 55.0.31 + RNOH 0.84.1。修改这些依赖后必须重新执行 `setup:native` 和 HAP 构建。
- 已验证 Hermes 导出、unsigned HAP 构建，以及 XYAO-W00（HarmonyOS 6.1 / API 24）上的签名 Release 覆盖安装。实测 DOCX 经 Worker 转 PDF 后，中文标题、正文、列表和表格正常显示，并可连续滚动到第二页。缩放、取消和缓存清理仍需继续验收。

## Pad 自适应

- `harmony.orientation: default` 允许系统旋转；布局由 `@shared/hooks/use-responsive-layout` 按当前窗口宽高计算，不按设备型号判断。竖向窗口宽度达到 744、横向窗口宽度达到 1024 才进入 expanded，窄分屏仍保持 compact。
- compact 保留底部 Tab 和模态会话抽屉；expanded 使用 76 dp 导航 rail、300/324 dp 常驻会话主栏和独立详情。会话与新建页支持主从布局，会话主栏位于按会话身份重建的 Provider 外；会话详情切换使用 `router.setParams` 保留 route key，同会话重复点击直接忽略，只有从新建页进入已有会话才跳转路由。
- 消息阅读区限制为 760 dp，新建表单为 680 dp；模型和更多输入弹层在 expanded 下居中并限宽 520 dp。设备卡片双列展示，个人页限制阅读宽度，待办复用导航 rail；待办详情主从未在本轮开启。
- `AdaptivePage` 保持同一棵 detail 组件树，旋转时不给布局或页面添加 key，避免清空草稿、附件和模型状态。该行为仍需在鸿蒙 Pad 真机上验证旋转、分屏、安全区、键盘和语音。
- 2026-11-21 已在鸿蒙 Pad 的签名 Release HAP 上验证：覆盖安装后保留登录态，横屏 expanded 导航 rail、已有会话详情与本地图标正常渲染。导航栏与聊天按钮的本地 PNG 使用 React Native `Image`，避免 SDK 55 的 `expo-image` 初始化崩溃；远程附件图片不在本次修复与验收范围内。
- 2026-11-21 同设备复验会话主栏：修复常驻抽屉未撑满高度导致滚动区为零的问题；工作区分组、会话标题/状态、右侧时间和底部状态栏正常显示。
- 2026-11-21 同设备两次冷启动复验顶部安全区：系统状态栏与导航 rail、设备主栏、会话标题及操作按钮不再重叠；主窗口同步 inset 补丁经完整 `setup:native -- release`、签名 HAP `verify-app` 和覆盖安装验证。

## 当前边界

- 原生 Stack 在本基线上出现白屏，因此使用 Slot；恢复前必须真机验证。
- `expo-speech-recognition` 无鸿蒙实现，当前 shim 不代表系统 ASR 可用。
- 火山 ASR 通过本地 `harmony-audio-stream` 原生模块采集 16 kHz 单声道 Int16 PCM，再按约 200 ms 聚包发送；支持边说边返回识别文本。该原生模块与麦克风权限变更必须重新执行 `setup:native`、构建并安装 HAP，不能仅靠 Reload 验收。
- 用户登录、语音播放/识别、附件、远程审批需要逐项真机验收；扫码配对入口已移除。
- 静态检查和 JS bundle 不等于 HAP 构建或真机通过。
- 生产跨网络必须使用 HTTPS/WSS；hdc reverse forwarding 只用于开发调试。
