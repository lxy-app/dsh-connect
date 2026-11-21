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

// tsconfig paths 提供共享 TSX 类型声明；精确运行时入口仍由本壳真实实现承担。
const runtimeModules = new Map([
  ['react', path.resolve(projectRoot, 'node_modules/react/index.js')],
  ['react/jsx-runtime', path.resolve(projectRoot, 'node_modules/react/jsx-runtime.js')],
  ['react/compiler-runtime', path.resolve(projectRoot, 'node_modules/react/compiler-runtime.js')],
  ['react-native', path.resolve(projectRoot, 'node_modules/react-native/index.js')],
]);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = runtimeModules.get(moduleName);
  if (filePath) return { type: 'sourceFile', filePath };
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
