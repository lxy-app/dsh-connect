# harmony-attachment-picker

DSH Connect 的应用内 HarmonyOS Expo 原生模块，为现有会话与新建会话提供拍照、相册图片和普通文件选择。系统选择器返回的临时 URI 不直接交给 JS 上传；模块先把内容复制到应用缓存并校验字节数，再返回文件 URI、显示名、MIME 和大小。

## 选择契约

- JS 方法：`HarmonyAttachmentPickerNative.pick(source, remainingSlots)`，原生层返回 JSON 信封，由应用侧 `apps/mobile-harmony/src/lib/attachment-picker-result.ts` 严格解析为草稿。
- 原生 Picker / `fs.copy` 使用 `fileUri.getUriFromPath` 生成的系统 URI；返回 JS 的缓存地址则使用 Expo Core 的 `fileUriFromPath`，生成无 authority、正确转义的 `file:///...`。JS 解析同时拒绝带应用 authority 的 URI，避免 `new File(uri).bytes()` 在上传前失败。
- `camera` 使用系统 `cameraPicker`，只拍摄图片；结果直接写入预先创建的应用缓存文件，不额外写入系统相册。系统相机 UI 由用户主动确认，不额外请求应用相机权限，依据 [OpenHarmony CameraPicker 指南](https://raw.githubusercontent.com/openharmony-rs/openharmony-docs/fc960716781ce9276eadd8fb08281527470d4b16/en/application-dev/media/camera/camera-picker.md)。
- `library` 使用 `photoAccessHelper.PhotoViewPicker`，允许多选图片，数量受剩余附件名额限制；通过临时授权查询所选资产的名称，再复制到缓存，不申请整库读取权限。
- `document` 使用 `DocumentViewPicker`，允许多选任意文件并复制到缓存，不申请宽泛存储权限。
- 取消返回 `cancelled`；选择、授权查询、复制或校验失败会拒绝 Promise，由 JS 适配层转成现有错误提示。
- 缓存文件使用随机 UUID 和受限扩展名，不把原始文件名拼进文件路径。MIME 优先来自系统 Uniform Type Descriptor，无法识别时为 `application/octet-stream`。
- 复制前先拒绝超过 20 MiB 的源文件；复制后校验字节数。多选中途失败会清理本批已复制文件，`PhotoAccessHelper` 在整批处理后释放；成功返回的缓存由页面所有权集合保留给上传与单项重试，并在未准入、移除、页面放弃或 prompt 成功后清理。
- 不记录系统 URI、缓存 URI、令牌或 Server 信息。6 项与 20 MiB 限制继续由现有共享草稿规则执行。

## 源码与构建

- TypeScript 入口：`src/index.ts`。
- ArkTS 实现：`harmony/library/src/main/ets/HarmonyAttachmentPickerModule.ets`。
- 模块声明：`expo-module.config.json`。

通常直接运行应用侧的 `npm run setup:native`，由 prebuild 构建并链接 HAR。只检查本模块时可在此目录运行 `npm run harmony:build` 或 `npm run harmony:inspect`（需已安装对应开发依赖）。新增该模块后必须重新构建并安装 HAP，JS Reload 不会添加原生实现。
