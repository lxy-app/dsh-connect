const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../mobile-shared');
const config = getDefaultConfig(projectRoot);

// 双端共享源码位于 App 目录之外；只监听并映射该目录，不引入整个仓库。
config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@shared': sharedRoot,
};

module.exports = config;
