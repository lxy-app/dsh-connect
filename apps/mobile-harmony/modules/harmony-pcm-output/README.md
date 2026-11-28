# harmony-pcm-output

应用内 Expo Harmony 原生模块：单个 ArkTS `AudioRenderer` 连续消费 24 kHz、单声道、S16LE 裸 PCM（不是 WAV/MP3 文件或播放列表）。仅在本模块存放源码；由应用的 Expo Harmony autolinking 接入，不能手改生成的 `apps/mobile-harmony/harmony/`。

## JS 契约

`HarmonyPcmOutputNative` 从 `src/index.ts` 导出，`isAvailable` 指示当前 HAP 是否包含模块。`start(rate = 1): Promise<number>` 创建 renderer 并返回本次原生播放会话的 `epoch`；如果启动途中已被停止则拒绝而不是返回失效会话。首个 `write(pcm: ArrayBuffer)` 才真正启动输出；rate 使用系统 `setSpeed`，仅允许 0.25–4，否则显式失败。`write` 在有限 512 KiB 原生队列满时 await 空位（单次最大 64 MiB，字节数必须为非零偶数）；调用方应串行 await write，不能无限并发投递。`pause` / `resume` 控制同一 renderer，`finish` 禁止再写并在缓冲消费完后 drain，发 `onFinished`；暂停时 `finish` 仅标记结束、不自动恢复，须在后续 resume 后等待 onFinished。`stop` 立即丢弃未播放数据并释放 renderer。

事件：`onStarted({ epoch, sampleRate: 24000, channels: 1 })`、`onFinished({ epoch })`、`onError({ epoch, message })`、`onStateChange({ epoch, state: 'idle' | 'playing' | 'paused' | 'draining' })`。JS 播放实例必须比较返回的 `epoch` 与事件 `epoch`，忽略旧 renderer 的迟到事件；停止后 `onFinished` 仍带刚结束会话的旧 epoch。网络断供时 renderer 补零静音而不是重播上次缓冲；无间隙播放仍取决于输入是否及时到达、系统调度及输出设备，**没有真机保证**。不把密钥或网络 I/O 送入原生模块。

模块在播放期间维护自己的 AVSession；进入后台且仍在播放时申请 `audioPlayback` 长时任务，回前台、暂停或结束时停止任务，reload/destroy/stop 释放媒体会话及音频资源。应用原有 `audioPlayback` 能力与 `KEEP_BACKGROUND_RUNNING` 权限已由 expo-audio 插件声明，但其内部后台保活只统计 Expo AudioPlayer/Playlist，不统计本模块自建 AudioRenderer。PCM 与 MP3 两条播放路径必须互斥；两者都对同一 UIAbility 管理后台任务，切换音源、后台通知、暂停及锁屏控制仍须真机验证。构建需 Expo SDK55 + RNOH 0.84.1 原生工具链；TS 类型检查不等于 HAR/HAP 编译或后台持续播放验收。
