#!/bin/bash
# 旧版 react-native-pdf 只有 C++ PdfViewPackage，需要移除不存在的 ArkTS 注册。
# 7.1.0 起已提供真正的 ArkTS PdfViewPackage 与 RTNPdfView builder，必须保留。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
FACTORY="$ROOT/harmony/entry/src/main/ets/RNOHPackagesFactory.ets"
ARKTS_PACKAGE="$ROOT/node_modules/@react-native-ohos/react-native-pdf/harmony/pdfview/src/main/ets/PdfViewPackage.ets"
if [ ! -f "$FACTORY" ]; then
  exit 0
fi

if [ -f "$ARKTS_PACKAGE" ]; then
  node - "$ARKTS_PACKAGE" <<'NODE'
const fs = require('fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const required = [
  'export class PdfViewPackage',
  'createWrappedCustomRNComponentBuilderByComponentNameMap',
  'RTNPdfView({',
];
for (const expected of required) {
  if (!source.includes(expected)) throw new Error(`PDF ArkTS Package 缺少预期实现：${expected}`);
}
NODE
  echo '[patch] 检测到有效 PDF ArkTS Package，保留自动链接注册'
  exit 0
fi

node - "$FACTORY" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const importLine = "import ReactNativeOhosReactNativePdfPackage from '@react-native-ohos/react-native-pdf';\n";
const registration = "    new ReactNativeOhosReactNativePdfPackage(ctx),\n";
const hasImport = source.includes(importLine);
const hasRegistration = source.includes(registration);
if (!hasImport && !hasRegistration) process.exit(0);
if (!hasImport || !hasRegistration) {
  throw new Error('RNOH PDF ArkTS factory shape changed; update the component-only patch explicitly.');
}
const next = source.replace(importLine, '').replace(registration, '');
fs.writeFileSync(file, next);
console.log(`[patch] ${file}: removed non-existent PDF ArkTS Package registration`);
NODE
