# harmony-file-export

DSH Connect 的应用内 HarmonyOS Expo 原生模块。它通过系统 `DocumentViewPicker` 让用户选择保存位置，再把已下载并校验的原附件复制到 picker 返回的 URI。模块不使用分享面板，也不把 App 私有缓存当作已保存到本地。

## 保存契约

- JS 方法：`HarmonyFileExportNative.save(sourceUri, suggestedName)`。
- `DocumentSaveOptions.newFileNames` 使用清理后的附件名；移除路径分隔符、NUL 和控制字符，空名、`.`、`..` 回退为 `attachment`。
- picker 返回空 URI 数组时返回 `cancelled`；picker 或文件操作抛错时拒绝 Promise。
- `fs.copy` 完成后重新打开源文件和目标文件，以 `fs.stat(fd)` 比较字节数；只有复制和校验都成功才返回 `saved`。
- 不记录源 URI、目标 URI、令牌或 Server 信息，目标 URI 也不返回到 JS 层。

## 源码与构建

- TypeScript 入口：`src/index.ts`。
- ArkTS 实现：`harmony/library/src/main/ets/HarmonyFileExportModule.ets`。
- 模块声明：`expo-module.config.json`。

通常直接运行应用侧的 `npm run setup:native`，由 prebuild 构建并链接 HAR。只检查本模块时可在此目录运行 `npm run harmony:build` 或 `npm run harmony:inspect`（需已安装对应开发依赖）。新增该模块后必须重新构建并安装 HAP，JS Reload 不会添加原生实现。
