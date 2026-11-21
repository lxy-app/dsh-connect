# AGENTS.md — HarmonyOS Mobile Shell

本目录是 DSH Connect 的鸿蒙运行时壳，与 `apps/mobile/`（iOS / Android）并列。不要把它当成主线 App 的降级分支，也不要把鸿蒙补丁扩散到共享业务代码。

## 固定技术基线

- Expo SDK **55.0.31**，RNOH **0.84.1**，Harmony 侧 React **19.2.3**。
- 主线 `apps/mobile/` 当前使用 SDK 58；两端独立 `package.json` 与 `package-lock.json`。
- 升级前必须核对 expo-harmony 与 RNOH 的实际支持矩阵，并完成真机验证；不要仅因主线升级而同步版本号。
- Expo/RN API 使用前查阅 SDK 55 文档：`https://docs.expo.dev/versions/v55.0.0/`，不要凭其他版本经验猜 API。

## 代码边界

- 通用业务、协议类型、流式恢复与纯 TS 逻辑放 `apps/mobile-shared/`，通过 `@shared/*` 引用。
- 本目录只放鸿蒙路由壳、平台实现、shim、vendor 和补丁。
- 不在共享目录写 `Platform.OS === 'harmony'` 分支；平台差异通过接口或本目录实现注入。
- 路由放 `src/app/`；组件、providers、hooks 和业务逻辑放对应非路由目录。
- 当前原生 Stack 在已验证基线上会导致白屏，根布局使用 Expo Router `Slot`；恢复 Stack 前必须真机验证。
- `expo-speech-recognition` 没有鸿蒙移植，只能使用 `src/shims/` 的明确降级或另接火山 ASR；不要假装系统 ASR 已可用。

## Pad 自适应

- 统一使用 `@shared/hooks/use-responsive-layout`，依据当前应用窗口而非设备型号：竖向窗口宽 ≥744、横向窗口宽 ≥1024 才进入 expanded；窄分屏保持 compact。
- `AdaptivePage` 必须保持同一棵 detail 组件树，不得按布局设置 key；会话主栏放在按会话身份重建的 `SessionModelProvider` 外。Pad 切换当前会话使用 `router.setParams` 保留 route key，同会话重复点击直接 no-op；参数合并时必须清除旧 `awaitingReply`，只有从新建页进入已有会话才跳转路由。
- compact 保持底部 Tab 和模态会话抽屉；expanded 使用导航 rail、常驻会话主栏和居中限宽弹层。键盘、语音、附件和原生 shim 仍留在详情与壳内。
- `harmony.orientation: default` 允许系统旋转；这不等于真机旋转已验收。修改后必须重新 `setup:native` 并构建 HAP。
- 共享 TSX 的 React 声明在本壳 `tsconfig.json` 中映射到 SDK 55 对应版本，RN 使用 `types/index.d.ts`；不要复用主线 `types_generated` 严格声明。`metro.config.js` 的 `resolveRequest` 仅对精确的 React / React Native 运行时入口返回本壳实现，不能让运行时解析到 `@types/*`。

## 常用命令

```bash
npm ci --legacy-peer-deps   # 安装本壳锁定依赖
npm run check               # ESLint + TypeScript
npm start                   # 鸿蒙 Metro（自动设置 EXPO_HARMONY / EXPO_METRO_TARGET）
npm run doctor              # DevEco / SDK / RNOH / Metro 环境诊断
npm run setup:native        # 打补丁、CNG prebuild、ohpm install（默认 debug）
npm run setup:native -- release  # 准备 Release autolinking 快照
npm run build:hap           # 构建 debug 签名/未签名 HAP
npm run build:hap -- release  # 构建 Release；变体切换时自动重新 setup:native
```

`npm run setup:native` 前如需真机安装，设置本地签名文件：

```bash
export EXPO_HARMONY_SIGNING_CONFIG_FILE=/absolute/path/to/signing.json
```

签名 JSON 字段与 DevEco 的 signing material 一致；文件和口令不得提交或写入日志。未设置时只允许未签名构建，不能宣称真机安装通过。

## 原生与补丁规则

- `harmony/` 是 CNG 生成物，已忽略；不要手改后当作永久方案。可重复修改必须进入 `scripts/` 或 `patches/`。
- `vendor/` 中的包记录上游版本和本地修改；不要把它们升级成与 RNOH 不匹配的版本。
- `scripts/patch-upstream.sh` 负责 expo-image 的 SDK API 修正与生成 Hvigor 脚本的 CLI 参数兼容；重复执行必须幂等。
- 不用简单占位 CMake 目标覆盖真实 HAR 的原生构建规则。
- 修改原生配置、权限或模块后，重新执行 `setup:native` 并构建 HAP。
- 鸿蒙使用 hdc，不使用 adb；不同网段时可用 `hdc rport` 做开发调试转发，正式使用走 HTTPS/WSS。

## 验证口径

- `npm run check` 只代表静态检查通过，不等于 HAP 构建或真机验收。
- 真机核心回归至少覆盖：配对、SecureStore 冷启动恢复、会话列表、WSS 重连、消息流。
- 相机扫码、语音、附件和远程审批若未实测，必须明确标为未验收。
- 修改共享代码时，同时运行 `apps/mobile/` 的 `npm run check && npm test` 与 `build:bundles`，避免主线回归。
