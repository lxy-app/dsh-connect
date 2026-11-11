# DSH Connect Mobile

DSH Connect 的 iOS / Android 移动客户端，基于 **Expo SDK 58、React Native 0.88、React 19.3 和 TypeScript**。

## 当前状态

已建立工程、Expo Router、明暗主题、原生首页，并完成真实手机配对、桌面访问授权与会话查看：

- 扫描管理后台生成的 `dshconnect://pair?...` 二维码。
- 手动输入 Server 地址和一次性配对码。
- 调用 `/v1/mobile/pair` 获取独立手机身份与 Access/Refresh Token。
- 使用系统 Keychain / Keystore 保存凭据。
- 启动时校验 `/v1/mobile/me`，Access Token 即将过期时自动轮换；API 调用遇到 401 时自动刷新一次并重试。
- 在“设备”页查看桌面与已开放工作区，提交访问申请；在桌面 DSH Connector 面板中由用户本人批准。
- “工作区”已迁入会话左侧抽屉，按桌面分组；每个工作区默认展开 5 条会话，支持查看更多与收起。“会话”入口恢复最近选中的聊天，聊天页保留底部导航。
- 聊天页右上角、抽屉“新建会话”和工作区旁 `+` 均可创建真实会话。新建页默认沿用当前设备/工作区，要求在线桌面及 `read + prompt` 授权；`POST /v1/mobile/sessions` 与首条 prompt 使用两个稳定 requestId，失败重试不会重复创建或发送，成功后进入聊天并立即接续等待状态与流式响应。
- 会话详情从 `/v1/mobile/sessions/{id}/messages` 读取稳定 transcript，空闲时每 3 秒轮询、等待响应时每 1.8 秒轮询；界面按 DSH turn 聚合为一张卡片：头部显示「深度求索中 / 已完成」与用时，折叠区里是单行工具步骤（名称 + 脱敏摘要 + 状态 + 耗时）和中间叙述，最终回复始终在折叠区外，朗读与时间每轮只出现一次。工具参数、命令输出、推理内容和注入的 runtime/time/skill context 不下发到手机。超长最终回复默认折叠为 14 行并可展开；会话运行期间通过 `/v1/mobile/events/ws` 接收 assistant 文本增量并实时追加，WSS 断开时自动回退到轮询，支持加载更早消息、手动刷新、发送/排队/执行等待状态和慢响应提示。新指令使用独立的等待回复气泡或新 Turn 卡片，不会把上一轮已完成回复重新标记为运行中；用户气泡与后续回复卡片之间保留固定间距。
- assistant 回复按 Markdown 渲染：标题、列表、粗体/斜体/删除线、行内代码、代码块、引用、表格、任务列表、链接和交付图片；流式增量也按 Markdown 实时呈现。普通链接只允许 http(s)/mailto 并由系统浏览器打开，交付图片使用内部不透明附件引用并在正文中等比显示。长消息折叠时显示纯文本摘要，展开后恢复完整排版。
- 在 `prompt` 授权下发送排队提示词，在 `cancel` 授权下停止当前 Turn；按住说话支持火山 Agent Plan Seed ASR 2.0 双向/单向 WebSocket 转写与系统 ASR，回复朗读和自动播报支持 Agent Plan Seed TTS 2.0 与系统 TTS。Agent Plan 密钥只通过 Keychain / Keystore 加密保存，云端错误会明确提示，不用格式检查或系统语音冒充云端调用成功。
- 云端回复朗读支持准备中取消、暂停/恢复、后台连续播放和锁屏/控制中心媒体按钮；开始录音时会暂停当前朗读并隔离录音与播放音频模式。系统 TTS 在 iOS 支持暂停/恢复，Android 因 `expo-speech` 平台限制提供停止后重新朗读。后台播放涉及原生配置，修改后必须重新构建 Development Build 并在真机验收。
- 会话输入区使用单胶囊容器：空闲时显示语音入口与更多选项，聚焦或有草稿时显示圆形发送按钮；录音时收起输入框和底部导航，仅保留光晕、波形与手势提示。向上滑动可取消本次识别；正常松开后仍按既有链路等待最终转写并回填输入框，由用户确认后发送。
- 会话模型通过 `/v1/mobile/sessions/{id}/model` 读取目录与当前选择；只读授权可直接查看，`prompt` 授权可从「＋ → 选择模型」切换模型和推理强度。切换只修改当前 Session，不改桌面默认；每个意图使用稳定 requestId，结果不确定时只允许同参数重试，切换待确认期间禁止发送。目录在进入会话和打开面板时主动刷新，活跃 WSS 的 `model/selection` 作为补充；迁移未完成时只读并提示先在桌面完成迁移。
- 在 `approve` 授权下接收桌面转发的一次性审批与提问：首页横幅与“待处理”页展示，会话内也会固定显示待答卡片；审批只能 `allow-once` 或 `reject`，提问支持选项与自定义文本。
- 会话中由 `present` 或 `dsh_im_return_file` 明确交付的图片随 transcript 展示：正文 Markdown 图片使用真实宽高比和 `contain` 完整显示，点击可进入全屏分页与应用内缩放；消息下方的附件区默认只展示文件卡，不渲染图片也不请求字节，点击卡片后才加载原图。附件字节使用带 Bearer Token 的独立 HTTPS 端点，不向手机暴露桌面路径，`attachment.ready` 到达后自动刷新。图片准备期间的 `202` 响应会有界自动重试，加载失败会显示原因并支持点击重试；认证快照获取失败也会自动恢复。非图片文件目前只展示信息，下载/保存/分享属于 M2。
- 支持撤销本机授权、断开本机并尽力吊销 Server 端手机凭据。
- “我的 → 外观”支持跟随系统、浅色和深色三种模式，选择会持久保存；页面、Markdown、底部导航、状态栏与原生弹窗同步切换，深色启动页使用独立背景色。

尚未实现：离线草稿、非图片文件下载/保存/分享（M2）、消息附件与手机上行（M3）、推送（APNs/FCM）、生物识别和 Web 端火山 ASR 中继。待处理列表由 2 秒轮询维持，App 回到前台会立即刷新，进入后台后停止轮询。

App 在前台轮询待处理项时，桌面会优先把审批交给手机（默认 6 秒窗口）；窗口内未作答则撤回手机卡片并改由桌面原生审批，因此两端不会同时出现两张卡。

远程审批依赖桌面先把 `approve` 写进设备授权（DSH Connect 面板“启用远程审批”）。已 active 的 grant 不支持原地升级：在“访问授权”页点“调整授权范围”撤销后重新勾选并提交，再由桌面确认。桌面未开放 `approve` 时，页面会用黄色提示说明。Server 的 bootstrap 会话 API 仍然不向移动 Token 开放；App 只使用受 grant 约束的 `/v1/mobile/*` API。

## 技术基线

- Expo Router 文件路由与 typed routes。
- Continuous Native Generation（CNG），原生目录由 `app.json` 和配置插件生成。
- `expo-dev-client`：使用自己的 Development Build，不以 Expo Go 作为目标运行环境。
- `expo-secure-store`：保存手机 Access/Refresh Token，以及语音和外观偏好，使用 Keychain / Keystore。
- `expo-system-ui`：支持 Android 明暗外观，并在主题切换时同步原生根视图背景色。
- `expo-local-authentication`：后续用于应用解锁和敏感操作确认。
- `expo-camera`：扫描配对二维码，不启用 Android 录音权限。
- `expo-audio`：采集 16 kHz、单声道、Int16 PCM 麦克风音频流，并播放云端或系统音频。
- `expo-file-system`：在缓存目录写入 TTS MP3 / PCM；`pako` 与 `base64-js` 处理 Agent Plan 线协议。
- `expo-sqlite`：后续保存草稿、游标和可重建缓存。
- `expo-notifications`：后续接入原生 APNs/FCM token 与通知深链。远程推送尚未实现，`app.json` 中 `enableRemoteNotifications` 保持 `false`，不向 iOS 工程写入 `aps-environment`；未来启用时需同时在 Apple Developer 账号、App ID 和签名 Profile 中配置 Push Notifications 能力。
- 聊天 Markdown 由 `src/lib/markdown.ts` 本地解析、`src/components/markdown.tsx` 按主题渲染，不引入第三方 Markdown 运行时依赖。
- 主要页面使用 `src/constants/theme.ts` 中的统一 Typography 层级：聊天与输入为 16px，普通说明为 13–14px，功能性辅助信息不低于 12px，并保留系统字体缩放。

### 品牌配色

- `src/constants/theme.ts` 集中定义银白品牌主题：浅色 accent 与 textSecondary 统一为品牌炭黑 `#232529`，分别覆盖灰色按钮、次级文字与未选中图标，accentSoft 为 `#E8EDF2`，主文字保持 `#181B20`；深色 accent 为图标白 `#F4F6F8`、accentSoft 为 `#353B43`，onAccent 分别使用白色与 `#171A1F` 保持对比。
- 深色会话页对齐 WorkBuddy：背景 `#1A1A1A`、卡片 `#242424`、输入区 `#303030`、用户气泡 `#383838`（文字 `#F2F2F2`）；消息时间不再放在气泡内，而是按 5 分钟间隔居中显示在消息组上方，助理回复使用无边框正文。
- 成功、警告、危险等语义色独立于品牌色，不随本次中性配色调整。
- `app.json` 的 Android 自适应图标、浅色/深色启动图和通知色使用同一套中性色；启动图由 `assets/logo-candidates/build-icon-assets.py` 生成。修改原生图标或启动配置后需要重新 prebuild 和原生构建。

相机权限只在打开扫码界面时请求；SecureStore 不需要额外权限，也不会在启动时注册推送。

## 环境要求

- Node.js 24（与仓库当前开发环境一致）。
- 本地 iOS 构建：macOS、Xcode 和 CocoaPods。
- 本地 Android 构建：Android Studio、Android SDK 和模拟器或真机。
- Face ID、生物识别保护凭据和远程推送需要在 Development Build 中验证；部分能力必须使用真机。

## 安装

```sh
npm install
```

如果本地 npm 镜像尚未同步最新 SDK 包，可只对本次安装使用官方源：

```sh
npm install --registry=https://registry.npmjs.org
```

新增或升级 Expo 原生模块时，始终使用 `npx expo install <package>`，让 CLI 选择与 SDK 58 匹配的版本。

## 手机配对流程

1. 打开 Web 管理后台 → **手机配对**，选择目标用户并生成手机配对二维码。二维码内容形如 `dshconnect://pair?code=…&server=…&v=1`。

   也可以直接调用管理 API：

   ```sh
   curl -sS -X POST "$DSH_CONNECT_SERVER_URL/v1/admin/mobile/pairing-codes" \
     -H "Authorization: Bearer $DSH_CONNECT_BOOTSTRAP_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"userId":"usr_xxx"}'
   ```

   注意：**桌面配对码不能用于手机配对**，两者使用不同接口和不同数据表。

2. 在 App 首页点击“连接 Server”，选择“扫描配对二维码”；也可以手动填写管理后台显示的 Server 地址和手机配对码。

3. App 调用 `/v1/mobile/pair`，成功后把 Access/Refresh Token 写入 SecureStore。

4. 后续启动会读取本机凭据并调用 `/v1/mobile/me` 验证；Access Token 临近过期时调用 `/v1/mobile/auth/refresh`，服务端会同时轮换两枚 Token。启动恢复与页面请求共用按设备凭据隔离的单飞刷新任务，轮换结果先写入 SecureStore 再发布给页面，避免一次性 Refresh Token 被并发消费；网络错误或超时会保留本机凭据供稍后重试。

5. “断开连接”会删除本机凭据，并尽力调用 `/v1/mobile/auth/logout` 吊销服务端手机。管理员也可在 `/v1/admin/mobile-devices/{id}/revoke` 强制吊销。

## 访问授权与会话

手机配对只证明设备身份，不会自动获得桌面权限。

1. App **设备** 页展示桌面 Connector 已开放的工作区与动作（来自 `/v1/mobile/access`）。
2. 选择工作区与动作后提交 `/v1/mobile/access/requests`，状态为 `pending`。
3. 打开桌面 DSH → DSH Connect 面板 → **手机访问授权**，核对手机名与请求范围，选择允许的工作区/动作后确认；也可以拒绝。
4. 回到 App 下拉刷新，`active` grant 的工作区会出现在 **工作区**，会话会出现在 **会话**。
5. 会话详情展示 user/assistant/tool 消息；`read`、`prompt`、`cancel` 分别控制查看、发送和停止。没有对应 scope 时输入框会变为只读提示，但仍可查看会话模型；只有 `prompt` 可以切换模型。
6. **我的 → 断开连接** 或设备页的撤销会立即回收授权；桌面端撤销同样即时生效。

授权校验是双重的：Server 校验 grant（手机、桌面、工作区、scope），Connector 再校验会话真实所属工作区。App 不缓存会话正文，每次向桌面拉取。

`dshconnect://pair?...` 同时注册为 `/pair` 深链路由；如果系统相机已经打开 App，也可以在 App 内再次扫描同一二维码。

### 真机连接注意

- 手机不能访问电脑的 `127.0.0.1`。Server 需要监听局域网地址或设置可达的 TLS 域名，例如：

  ```sh
  DSH_CONNECT_LISTEN_ADDR=0.0.0.0:8787
  DSH_CONNECT_SERVER_URL=http://192.168.1.100:8787
  ```

- 开发期允许 HTTP，但 App 会显示“明文连接”警告；生产环境必须使用 HTTPS。
- iOS 模拟器没有可用相机，可用深链验证连接页（系统会再确认一次“打开”）：

  ```sh
  xcrun simctl openurl booted \
    'dshconnect://pair?v=1&server=http%3A%2F%2F127.0.0.1%3A8787&code=TEST-CODE'
  ```

- `.env.example` 中的 `EXPO_PUBLIC_DSH_CONNECT_SERVER_URL` 只作为开发期的默认 Server 预填值，所有 `EXPO_PUBLIC_*` 都不允许存放 Token 或密钥。
- iOS 16+ 的 `Device.deviceName` 可能只返回通用 “iPhone”；此时 App 使用机型名作为手机名称。

### 凭据边界

- 明文 Access/Refresh Token 只存在于配对/刷新响应和 App 内存、SecureStore 中，数据库只保存 hash。
- 本机清除凭据不会删除桌面 DSH 会话。
- iOS Keychain 在卸载重装后可能仍保留旧条目；遇到异常态可重新配对，管理员也可吊销旧手机。

## 语音与火山 Agent Plan

接入契约以[火山 Agent Plan 语音模型文档](https://ark.volcengine.com/region:cn-beijing/docs/agent-plan-personal-voice-model)为准。

“我的 → 语音与模型服务”可分别选择 ASR / TTS 的服务提供方。默认优先使用火山 Agent Plan，也可独立切回系统语音；旧版单一 `provider` 设置会在读取时迁移到两个独立选项。

- ASR Resource-Id：`volc.seedasr.sauc.duration`。双向流式使用 `wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async`，完成后返回使用 `bigmodel_nostream`。麦克风音频按 16 kHz、单声道、Int16 PCM、gzip 二进制帧发送，松开时以负序号标记最后一包，收到服务器最终包后才回填文本。
- TTS Resource-Id：`seed-tts-2.0`。使用 `POST https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`，每个音频片段合并分块 MP3 并确认终端码 `20000000` 后播放。音色通过内置列表单选，不提供手填入口；默认音色为高冷御姐（`zh_female_gaolengyujie_uranus_bigtts`），试听与保存后的自动播报共用所选音色，列表外的旧配置回退到默认音色。
- 云端长回复按句子和长度分段：首段就绪即开始播放，播放当前段时最多预取下一段；段间未就绪会显示可取消的准备状态并保持后台音频会话；主动暂停切换为混音以释放独占音频，保留锁屏恢复，暂停跨越分段时不会自动出声；录音结束按实际播放/暂停状态恢复对应音频模式。音频文件以文本哈希、音色、服务地址和音频参数为缓存身份，不保存 API Key；缓存最多保留 100 个 MP3 / 32 MiB，超出后按最近写入时间清理。停止或切换消息会中止后续合成。
- 第三阶段在原生端使用 Agent Plan `wss://openspeech.bytedance.com/api/v3/plan/tts/unidirectional/stream` 一次性发送全文，以 PCM / 24 kHz 流式接收音频，再按 1 秒封装为 WAV 缓冲片段，通过 `expo-audio` 的 `AudioPlaylist` 原生连续队列增量播放，支持暂停/恢复、后台和锁屏控制。首音频等待 60 秒、后续帧空闲 30 秒会明确报错，不会在后台无限等待。完整 PCM 才会原子写入缓存供重播，取消或断流不发布部分缓存；首音频前失败会回退到第二阶段 HTTP 文件队列，Web 端仍使用 HTTP。
- 必须配置 Agent Plan 个人版专属 Key 或企业版席位 Key，不能使用按量平台普通 Key 代替。密钥只写入 SecureStore，不进入日志、SQLite、导航参数或 `EXPO_PUBLIC_*`。
- 浏览器 WebSocket 不能设置 ASR 握手鉴权头，因此 Web 端应选择系统 ASR；火山 ASR 的 Web 中继尚未实现。iOS / Android Development Build 可直接连接 Agent Plan。
- 云端合成或识别失败会显示真实错误。缺少最终包、只有部分音频或采样率不符合要求都不会被包装成成功。

## 本地 Development Build

首次构建并安装：

```sh
npm run ios
# 或
npm run android
```

这两个命令分别执行 `expo run:ios` / `expo run:android`，会生成原生目录、编译并安装应用，然后启动 Metro。

之后只修改 TypeScript/JavaScript 时，无需重新编译原生应用。新增 `expo-speech`、`expo-speech-recognition`、`expo-audio`、`expo-file-system` 原生模块或修改麦克风/语音识别权限配置后，必须先重新执行一次 `npm run ios` 或 `npm run android`，再使用 Metro 进行日常开发。

```sh
npm start
```

在已经安装的 DSH Connect Development Build 中打开当前 Metro 服务。修改原生依赖或 `app.json` 中的配置插件后，需要重新执行对应平台的构建命令。

## EAS Build（可选）

[eas.json](eas.json) 已提供 `development`、`preview` 和 `production` profile。Development Build 使用 `developmentClient: true` 和内部颁发方式。

```sh
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile development --platform android
```

EAS 构建需要登录、初始化远程项目并配置相应签名/推送凭据；当前仓库没有保存任何账号或凭据。EAS 不是本地开发的必要依赖。

## 检查与打包验证

```sh
npm run lint          # ESLint
npm run typecheck     # TypeScript strict
npm test              # ASR/TTS、Mobile API 与模型选择纯函数单元测试
npm run check         # lint + typecheck
npx expo-doctor       # SDK 依赖与配置诊断
npm run build:bundles # 生成 iOS / Android 生产 JS bundle
npx expo export --platform web # 验证 Expo Router 服务端/静态导出不会执行原生对象初始化
```

`build:bundles` 只验证 JavaScript/Hermes 打包，不等同于 Xcode/Gradle 原生构建或真机验收。原生 Release 流程还会执行 Expo Router 静态导出，因此原生模块路径、目录等对象应在实际功能调用时初始化，不要在模块顶层实例化。

## 双端共享与鸿蒙壳

- 本目录保持 SDK 58 的 iOS/Android 主线，不因鸿蒙适配降级。
- 通用协议类型、流式/消息分组等纯 TS 逻辑位于 `apps/mobile-shared/`，通过 `@shared/*` 引用；共享规则见其 `AGENTS.md`。
- 鸿蒙工程位于 `apps/mobile-harmony/`，使用独立 SDK 55 + RNOH 0.84.1 基线、lockfile 与 HAP 构建脚本，详见其 README。
- `metro.config.js` 只额外监听并映射 `../mobile-shared`。修改共享代码后除本工程检查/测试/bundle 外，还要运行鸿蒙壳的 `npm run check`。

## 配置与安全

- iOS bundle identifier：`app.lxy.dsh-connect`；Android package：`app.lxy.dshconnect`（Android 包名只允许字母、数字、`.` 和 `_`，不能带连字符）。
- URL scheme：`dshconnect`。
- `.env.example` 仅展示公开的默认 Server URL 配置。
- 所有 `EXPO_PUBLIC_*` 值都会进入应用包，严禁放入 bootstrap token、Access Token、Refresh Token 或设备密钥。
- 凭据只在运行时写入 SecureStore，不进入 AsyncStorage、SQLite、日志或导航参数。
- 本地 `.env`、原生签名和推送凭据已加入 `.gitignore`。
- 不手工编辑 `ios/` / `android/`；它们由 CNG 生成且已被忽略。

## 目录

```text
apps/mobile/
├── src/
│   ├── app/               # Expo Router 页面、连接页与 pair 深链
│   ├── components/        # 按钮、品牌标识等非路由 UI
│   ├── constants/         # 明暗主题
│   ├── features/pairing/  # 连接页、扫码界面、二维码解析
│   ├── hooks/             # 跨平台 hooks
│   ├── lib/               # Mobile API、SecureStore 会话
│   ├── providers/         # 配对状态、启动校验与 Token 刷新
│   └── types/             # 本壳私有类型；公共移动协议在 apps/mobile-shared/types/
├── assets/                # 应用图标和启动资源
├── app.json               # Expo 与原生能力配置
├── metro.config.js        # @shared/* 与 mobile-shared 监听配置
├── eas.json               # 可选 EAS 构建 profile
└── eslint.config.js       # Expo flat ESLint 配置
```

## 下一步

1. 继续完善移动 WSS 的重连、错误状态和后台恢复体验。
2. 增加离线草稿、消息级重试，以及 M2 非图片文件下载/保存/分享。
3. 注册 APNs/FCM、实现通知深链并验证后台恢复。
4. 为远程审批补充生物识别/二次确认与推送深链。
