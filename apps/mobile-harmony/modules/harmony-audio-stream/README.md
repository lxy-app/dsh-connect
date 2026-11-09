# harmony-audio-stream

DSH Connect 的应用内 HarmonyOS Expo 原生模块，使用 ArkTS `AudioCapturer` 向 JS 持续输出实时 PCM 音频。该包保持 private，由 Expo Modules autolinking 在 prebuild 时自动接入，无需发布或手改生成后的 `harmony/` 工程。

## 音频契约

- 采样率：16 kHz。
- 声道：单声道。
- 格式：小端 Int16 PCM（`SAMPLE_FORMAT_S16LE` / `ENCODING_TYPE_RAW`）。
- 输入源：`SOURCE_TYPE_VOICE_RECOGNITION`。
- 模块级事件：`onPcmData`、`onError`、`onStateChange`。
- 异步方法：`start()`、`stop()`；启动、停止和释放通过同一队列串行执行。

`readData` 回调只复制系统缓冲区并发送事件，不执行网络、压缩或文件写入。JS 侧再把任意大小的原生缓冲区聚合为约 200 ms 的 ASR 数据包。模块不支持后台录音，进入后台或销毁时会释放采集器。

## 源码与构建

- TypeScript 入口：`src/index.ts`。
- ArkTS 实现：`harmony/library/src/main/ets/HarmonyAudioStreamModule.ets`。
- 模块声明：`expo-module.config.json`。

通常直接运行应用侧的 `npm run setup:native`，由 prebuild 构建并链接 HAR。只检查本模块时可在此目录运行 `npm run harmony:build` 或 `npm run harmony:inspect`（需已安装对应开发依赖）。
