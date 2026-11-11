# DSH Connect HarmonyOS

DSH Connect 的鸿蒙运行时壳。与 `apps/mobile/` 的 iOS/Android 主线并列：**共享业务源码，但不共享 Expo 依赖版本或原生构建产物**。

当前基线为 Expo SDK 55.0.31 + RNOH 0.84.1，已在 HUAWEI Mate 80 Pro（HarmonyOS 7 / API 26）上完成签名 HAP 构建、安装、配对和真实远程 DSH 会话验证。

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

该命令依次执行：上游 HAR 补丁 → Expo CNG prebuild → OHPM 安装 → 解压副本修正。`harmony/` 是生成物并已忽略，不要手改作为永久方案。

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

## 当前边界

- 原生 Stack 在本基线上出现白屏，因此使用 Slot；恢复前必须真机验证。
- `expo-speech-recognition` 无鸿蒙实现，当前 shim 不代表系统 ASR 可用。
- 火山 ASR 通过本地 `harmony-audio-stream` 原生模块采集 16 kHz 单声道 Int16 PCM，再按约 200 ms 聚包发送；支持边说边返回识别文本。该原生模块与麦克风权限变更必须重新执行 `setup:native`、构建并安装 HAP，不能仅靠 Reload 验收。
- 相机扫码、语音播放/识别、附件、远程审批需要逐项真机验收。
- 静态检查和 JS bundle 不等于 HAP 构建或真机通过。
- 生产跨网络必须使用 HTTPS/WSS；hdc reverse forwarding 只用于开发调试。
