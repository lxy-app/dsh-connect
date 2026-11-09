# AGENTS.md — Shared Mobile Source

本目录存放 `apps/mobile/`（SDK 58）与 `apps/mobile-harmony/`（SDK 55 + RNOH）共同引用的源码。目录不是独立 npm 工程，不生成自己的 lockfile 或 `dist/`。

## 允许放入

- 协议 DTO、业务类型和纯 TypeScript 逻辑。
- 会话、配对、审批等可复用业务页面与 Provider。
- 仅依赖 `react` 或 `react-native` 基础组件的通用 UI。

## 禁止事项

- 不直接 import 带原生实现的 Expo 模块；通过平台接口或调用方注入。
- 不写 `Platform.OS === 'harmony'`、`ios`、`android` 的平台分叉实现；差异放对应 App 壳。
- 不引用某个 App 的 `src/`、assets、路由文件或 `node_modules`。
- 不保存 token、签名、密钥或设备私有数据。

## 引用与验证

- 业务方使用 `@shared/*`；目录内部优先使用相对导入，避免依赖调用方别名。
- 新增共享逻辑应在 `apps/mobile/src/lib/` 保留或新增对应测试。
- 修改后至少运行：
  - `npm --prefix apps/mobile run check`
  - `npm --prefix apps/mobile test`
  - `npm --prefix apps/mobile run build:bundles`
  - `npm --prefix apps/mobile-harmony run check`
- 涉及 UI 或原生能力时，另做双端真机验证；静态检查不等于原生验收。
