'use strict';

const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withHarmonyConfig } = require('@expo-harmony/metro-config');

const projectRoot = __dirname;
const isHarmony = process.env.EXPO_HARMONY === '1';
const config = getDefaultConfig(projectRoot);
const sharedRoot = path.resolve(projectRoot, '../mobile-shared');
config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@shared': sharedRoot,
};

// M0 说明：node_modules/react-native-screens 现在是完整上游 4.26.2 包，
// package.json 里补了 harmony.alias='react-native-screens' + redirectInternalImports=true，
// RNOH 扫描到后会把 `react-native-screens` 重定向到 @react-native-ohos/react-native-screens；
// 而鸿蒙包内部的 `react-native-screens/src/**` 自引用则由 RNOH 的 redirectInternalImports
// 折回鸿蒙包已有文件，缺失的（HeaderConfig/SearchBar/flags/types 等）会落到上游完整源码。
const merged = withHarmonyConfig(config, {
  enabled: isHarmony,
  projectRoot,
  aliases: {
    react: 'react-harmony',
    // expo-speech-recognition 没有鸿蒙移植，用本地空实现顶替，避免聊天页崩溃。
    // 会话页当前直接引用该 shim；保留别名以兼容其他尚未迁移的调用方。
    'expo-speech-recognition': path.join(projectRoot, 'src/shims/expo-speech-recognition.ts'),
  },
});

// M0 临时兜底：已发布的 @expo-harmony/cli@55.0.36-harmony.3 在 runtime contract 里读取
// resolver.resolveRequest.harmonyRuntime.fixedRuntime，而 @expo-harmony/metro-config@55.0.27-harmony.4
// 只写入 { reactPackage, harmonyPackage }，两者发布版本错位。这里补上该字段以通过校验，
// 仅用于本次可行性验证。
const resolveRequest = merged?.resolver?.resolveRequest;
if (resolveRequest && resolveRequest.harmonyRuntime && !resolveRequest.harmonyRuntime.fixedRuntime) {
  resolveRequest.harmonyRuntime = {
    ...resolveRequest.harmonyRuntime,
    fixedRuntime: {
      reactPackage: resolveRequest.harmonyRuntime.reactPackage,
      harmonyPackage: resolveRequest.harmonyRuntime.harmonyPackage,
    },
  };
}

module.exports = merged;
