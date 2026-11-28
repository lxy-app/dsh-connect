# DSH Connect Shared Mobile Source

`apps/mobile/` 与 `apps/mobile-harmony/` 共用的 TS/TSX 源码目录。不是独立 npm 工程，不生成 lockfile 或构建产物。

当前已接入：

- `types/mobile.ts`：移动协议与业务类型。
- `lib/turn-grouping.ts`：会话消息按 turn 分组。
- `lib/session-model.ts`：模型选择、目录与错误处理。
- `lib/format.ts`：时间、权限等展示格式化。
- `lib/pcm-stream.ts`：PCM 流式分片与 WAV 包装。
- `lib/speech-segments.ts`：播报文本分段。
- `lib/tts-cache-policy.ts`：TTS 缓存键与淘汰策略。
- `lib/pending-reply.ts`：提示词发送后的持久进度对齐。
- `lib/keyed-publish-queue.ts`：同 key 发布任务去重。
- `lib/responsive-layout.ts`：按应用窗口宽高计算 compact / expanded、导航 rail、会话主栏和阅读宽度。
- `useResponsiveLayout(false)` / `resolveResponsiveLayout({ width, height, hasMaster: false })` 用于无主栏页面，不扣除会话主栏宽度；默认保留会话布局兼容性。容器不改变详情树的位置，旋转时避免重建详情状态。
- `components/app-navigation.tsx`：底部 Tab 与 Pad 导航 rail 的展示组件，图标和主题由壳注入。
- `components/session-header.tsx`：会话页用圆形菜单展开侧栏，胶囊内分别新建会话和刷新，保留会话运行中/等待中/空闲状态。设备图标在副标题和抽屉中复用，绿点表示设备在线，副标题依次显示设备名和工作区名，窄屏点击可打开侧栏。
- `components/device-picker-sheet.tsx`：点击抽屉顶部设备行打开设备选择面板。手机使用底部面板，鸿蒙常驻主栏使用居中面板；点选设备后返回工作区列表。
- `components/session-master-detail.tsx`：会话主栏与详情的通用容器，不持有路由或会话状态。
- `hooks/use-responsive-layout.ts`：监听旋转、分屏和窗口尺寸变化。

调用方通过 `@shared/*` 引用；共享目录内部使用相对导入。平台能力和原生 Expo 模块由对应 App 注入，不在这里写平台分叉。共享 TSX 的 React 类型声明由两端 `tsconfig.json` 分别映射到各自锁定版本。

验证命令见本目录 `AGENTS.md`。
