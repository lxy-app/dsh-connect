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

调用方通过 `@shared/*` 引用；共享目录内部使用相对导入。平台能力和原生 Expo 模块由对应 App 注入，不在这里写平台分叉。

验证命令见本目录 `AGENTS.md`。
