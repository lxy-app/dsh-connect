# Vendor 说明

本目录保存鸿蒙基线暂时不能直接使用的上游包。所有包都固定版本，升级前必须重新验证 Metro 解析、HAR autolinking、原生编译和真机运行。

| 目录 | 上游版本 | 本地用途与修改 |
|---|---|---|
| `react-native-screens/` | 4.26.2 | 完整上游 JS；补 `harmony.alias`、鸿蒙 Tabs 占位组件；移除本仓库不需要的上游构建脚本 |
| `react-native-gesture-handler/` | 2.30.1 | 完整上游 JS；补 `harmony.alias`；移除本仓库不需要的上游构建脚本 |
| `ohos-screens-har/` | 4.26.2-rnoh084.0 | 只提供 screens 鸿蒙 HAR；`index.js` 将 JS 入口转发给上游包 |
| `ohos-gesture-handler-har/` | 2.30.2 | 只提供 gesture-handler 鸿蒙 HAR；`index.js` 将 JS 入口转发给上游包 |

不要把 HAR 的原始 CMake 规则替换成简单占位目标。若原生依赖布局变化，先恢复原始 HAR 再排查，避免把自建规则问题误判为上游缺陷。
